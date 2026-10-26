import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { withLocalStateLock } from "../../lib/atomic-local-state.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { IngestJobStore } from "../ingest/IngestJobStore.mjs";
import { JobStore } from "../JobStore.mjs";
import { resolveKickSource, kickViewerRequest } from "./KickPublicSourceService.mjs";
import { liveMediaSize } from "./LiveSessionStore.mjs";
import { LiveObservationStore } from "./LiveObservationStore.mjs";
import { buildChatActivityWindows } from "../analysis/ChatActivityService.mjs";

const SOURCE = "https://kick.com/westcol";
function jobId(key) {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
/** Bounded, single-host supervisor of the existing ingest/media queues.
 * It cannot publish, change providers, delete media, or start paid model calls.
 * Its checkpoint AND both job queues need a persistent shared volume.
 */
export class LiveMonitorService {
  constructor({ root = getStorageRoot(), env = process.env, resolveSource = resolveKickSource,
    ingestStore = new IngestJobStore(), mediaStore = new JobStore(), observations = new LiveObservationStore({ root, env }),
    now = Date.now, checkCapacity } = {}) {
    Object.assign(this, { root, env, resolveSource, ingestStore, mediaStore, observations, now });
    this.directory = path.join(root, "live-monitor"); this.file = path.join(this.directory, "westcol.json");
    this.checkCapacity = checkCapacity || (async () => {
      const capacity = await statfs(root);
      const used = await liveMediaSize(path.join(root, "uploads")) + await liveMediaSize(path.join(root, "clips")) + await liveMediaSize(path.join(root, "live-sessions"));
      return capacity.bavail * capacity.bsize >= 1024 ** 3 && used < 2 * 1024 ** 3;
    });
  }
  async read() {
    try {
      const raw = await readFile(this.file, "utf8"); if (raw.length > 512000) throw new Error("oversized");
      const saved = JSON.parse(raw);
      if (saved.version !== 1 || saved.url !== SOURCE || !Array.isArray(saved.handledReactions)) throw new Error("invalid");
      return saved;
    } catch (error) {
      if (error.code !== "ENOENT") throw new Error("El checkpoint del monitor necesita recuperación; no se crean capturas duplicadas.");
      return { version: 1, url: SOURCE, status: "DISABLED", sequence: 0, activeJobId: null, source: null, handledReactions: [], history: [], publication: "OFF" };
    }
  }
  async save(state) {
    state.updatedAt = new Date(this.now()).toISOString();
    state.history = (state.history || []).slice(-256); state.handledReactions = state.handledReactions.slice(-256);
    await mkdir(this.directory, { recursive: true });
    const temporary = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(state, null, 2), { mode: 0o600 }); await rename(temporary, this.file);
    return state;
  }
  async pause() {
    return withLocalStateLock(this.file,async()=>this.save({...await this.read(),pausedByOwner:true,status:"OWNER_PAUSED"}));
  }
  async tick() {
    try{return await withLocalStateLock(this.file,async()=>this.#tick(await this.read()),{timeoutMs:1000});}
    catch(error){if(error.code==="STATE_BUSY")return {status:"BUSY",publication:"OFF"};throw error;}
  }
  async #tick(state) {
    if(state.pausedByOwner===true)return this.save({...state,status:"OWNER_PAUSED"});
    if (this.env.CLIPFORGE_LIVE_MONITOR_ENABLED !== "true") return this.save({ ...state, status: "DISABLED" });
    if (this.env.CLIPFORGE_LIVE_RIGHTS_CONFIRMED !== "true") return this.save({ ...state, status: "WAITING_RIGHTS_CONFIRMATION" });
    if (this.env.CLIPFORGE_STORAGE_PERSISTENT !== "true") return this.save({ ...state, status: "WAITING_PERSISTENT_STORAGE" });
    if (this.env.CLIPFORGE_ANALYSIS_PROVIDER !== "heuristic") return this.save({ ...state, status: "WAITING_LOCAL_ANALYSIS_PROVIDER" });
    state.downstream ||= []; state.captureFailures ||= 0;
    let active = state.activeJobId ? await this.ingestStore.get(state.activeJobId) : null;
    if (state.activeJobId && !active) return this.save({ ...state, status: "JOB_STATE_MISSING" });
    if (active && ["COMPLETED", "FAILED", "CANCELLED"].includes(active.status)) {
      // Enqueueing/encoding/archival are now independent of capture. Preserve
      // legacy jobs as downstream work; never await their editor or R2 here.
      if (active.result?.clipsJobId) state.downstream.push({ ingestJobId: active.id, mediaJobId: active.result.clipsJobId });
      state.history.push({ jobId: active.id, captureStatus: active.status, sessionId: active.result?.sessionId || null });
      if (state.recoveryPeak) state.handledReactions.push(state.recoveryPeak);
      state.captureFailures = active.status === "FAILED" ? state.captureFailures + 1 : 0;
      state.activeJobId = null; state.recoveryPeak = null; state.sequence++; active = null;
      state.downstream = state.downstream.slice(-256); await this.save(state);
    }
    let resolved;
    try { resolved = await this.resolveSource(SOURCE); state.sourceState = "LIVE"; }
    catch (error) {
      state.sourceState = error.code === "SOURCE_OFFLINE" ? "OFFLINE" : "UNKNOWN";
      if (active) return this.save({ ...state, status: "CAPTURE_QUEUED_OR_RUNNING", captureStatus: active.status, errorCode: error.code });
      if (error.code !== "SOURCE_OFFLINE") return this.save({ ...state, status: "SOURCE_ERROR", errorCode: error.code || "SOURCE_UNAVAILABLE" });
      if (!state.source) return this.save({ ...state, status: "OFFLINE" });
      let id = state.source.sourceId;
      try {
        if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(id)) {
          const list = await kickViewerRequest(`https://web.kick.com/api/v1/channels/${state.source.channelId}/videos`, { stage: "MONITOR_VOD_LOOKUP" });
          id = list.data?.find(v => v.status === "public" && Math.abs(Date.parse(v.start_time)-Date.parse(state.source.startedAt)) <= 5000)?.id;
          if (!id) return this.save({ ...state, status: "WAITING_MATCHING_VOD" });
        }
        const vod = await this.resolveSource(`${SOURCE}/videos/${id}`);
        const observed = await this.observations.loadForSource(vod.metadata);
        const peaks = buildChatActivityWindows(observed.bins,{sourceStartUtc:vod.metadata.startedAt});
        const peak = peaks.find(w => (w.isCollectiveReaction || w.isPeak) && w.score >= 25 && !state.handledReactions.some(t => Math.abs(Date.parse(t)-Date.parse(w.utc)) < 30000));
        if (!peak) return this.save({ ...state, status: observed.cloudError ? "OBSERVATION_RECOVERY_ERROR" : "OFFLINE" });
        state.recoveryPeak=peak.utc;
        resolved={...vod,canonicalUrl:`${SOURCE}/videos/${id}`,startTimeSeconds:Math.max(0,peak.start-25),captureSeconds:90};
      } catch { return this.save({ ...state, status: "WAITING_MATCHING_VOD" }); }
    }
    if (active) {
      if (state.source?.sourceId !== resolved.metadata.sourceId) {
        await this.ingestStore.cancel(active.id);
        return this.save({ ...state, status: "STOPPING_CHANGED_TRANSMISSION", nextSourceId: resolved.metadata.sourceId });
      }
      return this.save({ ...state, status: "CAPTURE_QUEUED_OR_RUNNING", captureStatus: active.status, chat: active.details || null });
    }
    if (!await this.checkCapacity()) return this.save({ ...state, status: "LOCAL_STORAGE_LIMIT" });
    if (state.captureFailures >= 3 && state.source?.sourceId === resolved.metadata.sourceId) return this.save({ ...state, status: "CAPTURE_RECOVERY_REQUIRED" });
    if (state.source?.sourceId !== resolved.metadata.sourceId) state.captureFailures=0;
    state.source=resolved.metadata;
    const id=jobId(`westcol:${state.source.sourceId}:${state.recoveryPeak || state.sequence}`);
    const job=await this.ingestStore.create({ id, url:resolved.canonicalUrl || SOURCE, mode:"STREAM", captureSession:true, expectedSource:state.source,
      captureSeconds:resolved.captureSeconds || 21600, startTimeSeconds:resolved.startTimeSeconds || 0, segmentSeconds:60,
      autoClip:true,clipMode:"SEGMENTS",clipCount:10,clipDuration:30,subtitles:false,contentProfile:"ENTERTAINMENT",onlyChatReactions:true,analysisProvider:"heuristic" });
    state.activeJobId=job.id;state.status=state.recoveryPeak ? "VOD_RECOVERY_QUEUED" : "CAPTURE_QUEUED";state.errorCode=null;
    return this.save(state);
  }
}
