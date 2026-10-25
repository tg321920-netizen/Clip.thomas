import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, statfs, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { IngestJobStore } from "../ingest/IngestJobStore.mjs";
import { JobStore } from "../JobStore.mjs";
import { ClipLibraryService } from "../storage/ClipLibraryService.mjs";
import { resolveKickSource, kickViewerRequest } from "./KickPublicSourceService.mjs";
import { LiveObservationStore } from "./LiveObservationStore.mjs";
import { buildChatActivityWindows } from "../analysis/ChatActivityService.mjs";

const SOURCE = "https://kick.com/westcol";
function jobId(key) {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
async function treeSize(directory) {
  let bytes = 0;
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === "ENOENT") return []; throw e; })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) bytes += await treeSize(file);
    else if (entry.isFile()) bytes += (await stat(file)).size;
  }
  return bytes;
}

/** Bounded, single-host supervisor of the existing ingest/media queues.
 * It cannot publish, change providers, delete media, or start paid model calls.
 * Its checkpoint AND both job queues need a persistent shared volume.
 */
export class LiveMonitorService {
  constructor({ root = getStorageRoot(), env = process.env, resolveSource = resolveKickSource,
    ingestStore = new IngestJobStore(), mediaStore = new JobStore(), observations = new LiveObservationStore({ root, env }),
    loadProject = loadProjectFile, archive, now = Date.now, checkCapacity } = {}) {
    Object.assign(this, { root, env, resolveSource, ingestStore, mediaStore, observations, loadProject, now });
    this.archive = archive || ((project, clip) => new ClipLibraryService().archive(project, clip));
    this.directory = path.join(root, "live-monitor"); this.file = path.join(this.directory, "westcol.json");
    this.checkCapacity = checkCapacity || (async () => {
      const capacity = await statfs(root);
      const used = await treeSize(path.join(root, "uploads")) + await treeSize(path.join(root, "clips"));
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
  async tick() {
    await mkdir(this.directory, { recursive: true });
    const lockPath = `${this.file}.lock`;
    // A lease is held for one bounded poll, not for a capture. Its TTL is longer
    // than the upstream metadata request timeouts; only one host is supported.
    let lock;
    try { lock = await open(lockPath, "wx"); await lock.close(); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (this.now() - (await stat(lockPath)).mtimeMs > 20 * 60 * 1000) await rm(lockPath, { force: true });
      return { status: "BUSY", publication: "OFF" };
    }
    try { return await this.#tick(await this.read()); }
    finally { await rm(lockPath, { force: true }); }
  }
  async #tick(state) {
    if (this.env.CLIPFORGE_LIVE_MONITOR_ENABLED !== "true") return this.save({ ...state, status: "DISABLED" });
    if (this.env.CLIPFORGE_LIVE_RIGHTS_CONFIRMED !== "true") return this.save({ ...state, status: "WAITING_RIGHTS_CONFIRMATION" });
    if (this.env.CLIPFORGE_STORAGE_PERSISTENT !== "true") return this.save({ ...state, status: "WAITING_PERSISTENT_STORAGE" });
    // A local/free selection path must be explicitly installed before starting
    // supervision. No fallback to a paid configured API is permitted here.
    if (this.env.CLIPFORGE_ANALYSIS_PROVIDER !== "heuristic") return this.save({ ...state, status: "WAITING_LOCAL_ANALYSIS_PROVIDER" });
    if (state.activeJobId) {
      const job = await this.ingestStore.get(state.activeJobId);
      if (!job) return this.save({ ...state, status: "JOB_STATE_MISSING" });
      if (!["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return this.save({ ...state, status: "CAPTURE_QUEUED_OR_RUNNING", captureStatus: job.status, chat: job.details || null });
      if (job.status === "COMPLETED" && job.result?.clipsJobId) {
        const media = await this.mediaStore.get(job.result.clipsJobId);
        if (!media) return this.save({ ...state, status: "MEDIA_JOB_STATE_MISSING" });
        if (!["READY", "WAITING_RESOURCE", "FAILED", "CANCELLED"].includes(media.status)) return this.save({ ...state, status: "WAITING_EDITOR", captureStatus: "COMPLETED" });
        if (media.status === "READY") {
          const project = await this.loadProject(media.projectId);
          if (!project || media.validation?.valid !== true) return this.save({ ...state, status: "MEDIA_VALIDATION_MISSING" });
          try {
            for (const clip of project.clips || []) {
              const archive = await this.archive(project, clip);
              if (archive?.status !== "READY") return this.save({ ...state, status: "WAITING_PRIVATE_STORAGE" });
            }
          } catch { return this.save({ ...state, status: "WAITING_PRIVATE_STORAGE" }); }
          for (const candidate of project.analysis?.candidates || []) {
            if (Number.isFinite(Date.parse(candidate.chatEvidence?.peakUtc))) state.handledReactions.push(candidate.chatEvidence.peakUtc);
          }
        }
        state.lastEditorStatus = media.status;
      }
      state.history.push({ jobId: job.id, captureStatus: job.status, editorStatus: state.lastEditorStatus || null });
      if (state.recoveryPeak) state.handledReactions.push(state.recoveryPeak);
      state.activeJobId = null; state.recoveryPeak = null; state.sequence++;
      await this.save(state);
    }
    if (!await this.checkCapacity()) return this.save({ ...state, status: "LOCAL_STORAGE_LIMIT" });
    let resolved;
    try { resolved = await this.resolveSource(SOURCE); }
    catch (error) {
      if (error.code !== "SOURCE_OFFLINE") return this.save({ ...state, status: "SOURCE_ERROR", errorCode: error.code || "SOURCE_UNAVAILABLE" });
      state.status = "OFFLINE";
      if (!state.source) return this.save(state);
      // Recover only the same transmission, never an arbitrary latest VOD.
      let vod;
      try {
        let id = state.source.sourceId;
        if (!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(id)) {
          const list = await kickViewerRequest(`https://web.kick.com/api/v1/channels/${state.source.channelId}/videos`, { stage: "MONITOR_VOD_LOOKUP" });
          id = list.data?.find(v => v.status === "public" && Math.abs(Date.parse(v.start_time) - Date.parse(state.source.startedAt)) <= 5000)?.id;
          if (!id) return this.save({ ...state, status: "WAITING_MATCHING_VOD" });
        }
        vod = await this.resolveSource(`${SOURCE}/videos/${id}`);
      } catch { return this.save({ ...state, status: "WAITING_MATCHING_VOD" }); }
      const observations = await this.observations.loadForSource(vod.metadata);
      const peaks = buildChatActivityWindows(observations.bins, { sourceStartUtc: vod.metadata.startedAt });
      const peak = peaks.find(w => (w.isCollectiveReaction || w.isPeak) && w.score >= 25 &&
        !state.handledReactions.some(t => Math.abs(Date.parse(t) - Date.parse(w.utc)) < 30000));
      if (!peak) return this.save({ ...state, status: observations.cloudError ? "OBSERVATION_RECOVERY_ERROR" : "OFFLINE", error: observations.cloudError || null });
      state.recoveryPeak = peak.utc;
      resolved = { ...vod, canonicalUrl: `${SOURCE}/videos/${vod.metadata.sourceId}`, startTimeSeconds: Math.max(0, peak.start - 25), captureSeconds: 90 };
    }
    state.source = resolved.metadata;
    const id = jobId(`westcol:${state.source.sourceId}:${state.recoveryPeak || state.sequence}`);
    const job = await this.ingestStore.create({ id, url: resolved.canonicalUrl || SOURCE, mode: "STREAM", captureSeconds: resolved.captureSeconds || 300,
      startTimeSeconds: resolved.startTimeSeconds || 0, segmentSeconds: 60, autoClip: true, clipMode: "CAPTURE", clipCount: 10, clipDuration: 30,
      subtitles: false, contentProfile: "ENTERTAINMENT", onlyChatReactions: true, analysisProvider: "heuristic", excludedReactionPeaks: state.handledReactions });
    state.activeJobId = job.id; state.status = state.recoveryPeak ? "VOD_RECOVERY_QUEUED" : "CAPTURE_QUEUED";
    state.errorCode = null;
    return this.save(state);
  }
}
