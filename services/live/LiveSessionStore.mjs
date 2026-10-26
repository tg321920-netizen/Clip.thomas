import { readFile, readdir, statfs, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { withLocalStateLock, writeAtomicJson } from "../../lib/atomic-local-state.mjs";

export function liveId(key) { const h = createHash("sha256").update(key).digest("hex"); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
export function cleanLiveSource(source) {
  if (!source || !/^[a-z0-9-]{1,100}$/iu.test(String(source.sourceId || ""))) throw new Error("Falta la identidad verificable de la transmisión.");
  return Object.fromEntries(["platform", "channel", "channelId", "chatroomId", "sourceId", "sourceKind", "startedAt", "title", "durationSeconds"].filter(k => source[k] !== undefined).map(k => [k, source[k]]));
}
export async function liveMediaSize(directory, {statFile=stat}={}) {
  let size = 0;
  const entries = await readdir(directory, { withFileTypes: true }).catch(e => { if (e.code === "ENOENT") return []; throw e; });
  for (const entry of entries) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) size += await liveMediaSize(file,{statFile});
    else if (entry.isFile()) { try { size += (await statFile(file)).size; } catch(error) { if(error.code!=="ENOENT")throw error; } }
  }
  return size;
}

/** Manifest of immutable originals; local durability requires a real volume.
 * R2 archival/checkpointing is performed by another worker, never capture. */
export class LiveSessionStore {
  constructor({ root = getStorageRoot(), now = Date.now } = {}) { this.root = root; this.now = now; }
  file(id) { if (!isProjectId(id)) throw new Error("Sesión no válida."); return path.join(this.root, "live-sessions", id, "session.json"); }
  async get(id) {
    try {
      const bytes = await readFile(this.file(id)); if (bytes.length > 2_000_000) throw new Error("Manifest limit");
      const state = JSON.parse(bytes);
      if (state.version !== 1 || state.id !== id || !Array.isArray(state.segments) || !Array.isArray(state.windows) || !Array.isArray(state.gaps)) throw new Error("Manifest invalid");
      return state;
    } catch (error) { if (error.code === "ENOENT") return null; throw Object.assign(new Error("El manifiesto necesita recuperación; los originales se conservan."), { code: "LIVE_STATE_INVALID" }); }
  }
  async create(id, source) {
    return withLocalStateLock(this.file(id), async () => {
      const existing = await this.get(id); if (existing) return existing;
      const state = { version: 1, id, source: cleanLiveSource(source), createdAt: new Date(this.now()).toISOString(), updatedAt: new Date(this.now()).toISOString(),
        capture: { status: "QUEUED", attempts: 0 }, chat: { status: "WAITING_SOURCE", acceptedMessages: 0 }, segments: [], windows: [], gaps: [], publication: "OFF" };
      await writeAtomicJson(this.file(id), state); return state;
    });
  }
  async update(id, action) {
    return withLocalStateLock(this.file(id), async () => {
      const state = await this.get(id); if (!state) throw new Error("No existe la sesión.");
      await action(state); state.updatedAt = new Date(this.now()).toISOString();
      if (state.segments.length > 1440 || state.windows.length > 1440 || state.gaps.length > 1440) throw Object.assign(new Error("Se alcanzó el límite de sesión; inicia otra sin descartar sus originales."), { code: "LIVE_SESSION_LIMIT" });
      await writeAtomicJson(this.file(id), state); return state;
    });
  }
  async addSegment(id, segment) {
    if (!Number.isSafeInteger(segment.index) || segment.index < 0 || !/^[a-f0-9]{64}$/u.test(segment.sha256) ||
      !Number.isFinite(segment.durationSeconds) || segment.durationSeconds <= 0 ||
      segment.relativePath !== `live-sessions/${id}/capture/.stream-parts/part-${String(segment.index).padStart(6,"0")}.ts`) throw new Error("Segmento no válido.");
    return this.update(id, state => {
      const existing = state.segments.find(s => s.index === segment.index);
      if (existing) {
        if (existing.sha256 !== segment.sha256) throw Object.assign(new Error("Cambió un segmento retenido; no se sobrescribe."), { code: "LIVE_SEGMENT_CHANGED" });
        return;
      }
      const previous = state.segments.at(-1), start = Date.parse(segment.sourceStartUtc);
      if (previous && Number.isFinite(start) && Number.isFinite(Date.parse(previous.sourceStartUtc))) {
        const end = Date.parse(previous.sourceStartUtc) + previous.durationSeconds * 1000;
        if (start - end > 1000 && !state.gaps.some(g=>Date.parse(g.fromUtc)===end&&(g.toUtc===null||g.toUtc===segment.sourceStartUtc))) state.gaps.push({ fromUtc: new Date(end).toISOString(), toUtc: segment.sourceStartUtc, reason: "SOURCE_OR_RESTART_GAP", durationSeconds: (start - end) / 1000 });
        if (start < end - 1000) segment.continuityWarning = "SOURCE_TIME_OVERLAP";
      }
      const open = state.gaps.find(g => g.toUtc === null);
      if (open && Number.isFinite(start)) { open.toUtc = segment.sourceStartUtc; open.durationSeconds = Math.max(0, (start - Date.parse(open.fromUtc)) / 1000); }
      state.segments.push({ ...segment, status: "CAPTURED", validation: null, archive: { status: "PENDING" } }); state.segments.sort((a,b) => a.index-b.index);
      state.capture.lastSegmentAt = segment.closedAt; state.capture.lastSourceUtc = segment.sourceStartUtc;
    });
  }
  async gap(id, reason, fromUtc) {
    return this.update(id, state => {
      if (!state.gaps.some(g => g.toUtc === null)) state.gaps.push({ fromUtc: fromUtc || new Date(this.now()).toISOString(), toUtc: null, reason, durationSeconds: null });
    });
  }
  async validateSegment(id,index,validation) {
    return this.update(id,state=>{
      const row=state.segments.find(s=>s.index===index);if(!row)throw new Error("No existe el segmento.");row.validation=validation;
      for(const gap of validation.packetGaps || []){
        if(!row.sourceStartUtc)continue;
        const fromUtc=new Date(Date.parse(row.sourceStartUtc)+gap.start*1000).toISOString(),toUtc=new Date(Date.parse(row.sourceStartUtc)+gap.end*1000).toISOString();
        if(!state.gaps.some(g=>g.reason==="PACKET_TIMESTAMP_GAP"&&g.fromUtc===fromUtc&&g.toUtc===toUtc))state.gaps.push({fromUtc,toUtc,reason:"PACKET_TIMESTAMP_GAP",durationSeconds:gap.end-gap.start,segmentIndex:index});
      }
    });
  }
  async list() {
    const names = await readdir(path.join(this.root, "live-sessions")).catch(e => { if (e.code === "ENOENT") return []; throw e; });
    const states = [];
    for (const id of names.filter(isProjectId).slice(-200)) { const state = await this.get(id); if (state) states.push(state); }
    return states.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  }
  async capacity({ maxBytes = 2 * 1024 ** 3, minFreeBytes = 1024 ** 3 } = {}) {
    const disk = await statfs(this.root);
    const usedBytes = (await Promise.all(["live-sessions", "uploads", "clips"].map(name => liveMediaSize(path.join(this.root, name))))).reduce((a,b) => a+b, 0);
    const freeBytes = disk.bavail * disk.bsize;
    return { allowed: usedBytes < maxBytes && freeBytes >= minFreeBytes, usedBytes, maxBytes, freeBytes, minFreeBytes };
  }
}
