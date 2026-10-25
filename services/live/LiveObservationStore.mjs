import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { R2ObjectStore, readR2Config } from "../storage/R2ObjectStore.mjs";
import { buildChatActivityWindows } from "../analysis/ChatActivityService.mjs";

const PREFIX = "clipforge-managed/v1/observations/";
export function sameLiveSource(a, b) {
  if (!a || !b || String(a.channelId) !== String(b.channelId)) return false;
  return String(a.sourceId) === String(b.sourceId) ||
    (Number.isFinite(Date.parse(a.startedAt)) && Math.abs(Date.parse(a.startedAt) - Date.parse(b.startedAt)) <= 5000);
}
function cleanSource(source) {
  if (!/^\d+$/u.test(String(source?.channelId)) || !/^[a-z0-9-]{1,80}$/iu.test(String(source?.sourceId))) throw new Error("La identidad de la observación no es válida.");
  return { channel: String(source.channel || ""), channelId: String(source.channelId), chatroomId: String(source.chatroomId || ""),
    sourceId: String(source.sourceId), sourceKind: source.sourceKind, startedAt: Number.isFinite(Date.parse(source.startedAt)) ? new Date(source.startedAt).toISOString() : null };
}
function cleanBins(bins) {
  return (Array.isArray(bins) ? bins : []).slice(-1440).filter(bin => Number.isFinite(Date.parse(bin.utc)) &&
    [bin.messages, bin.uniqueSenders, bin.distinctTexts].every(n => Number.isSafeInteger(n) && n >= 0 && n <= 100000) &&
    bin.uniqueSenders <= bin.messages && bin.distinctTexts <= bin.messages).map(bin => ({
    utc: new Date(bin.utc).toISOString(), messages: bin.messages, uniqueSenders: bin.uniqueSenders, distinctTexts: bin.distinctTexts, complete: bin.complete !== false,
    ...(Number.isSafeInteger(bin.dominantTextCount) && Number.isSafeInteger(bin.dominantTextSenders) && bin.dominantTextCount >= bin.dominantTextSenders &&
      bin.dominantTextCount <= bin.messages && bin.dominantTextSenders >= 0 && bin.dominantTextSenders <= bin.uniqueSenders
      ? { dominantTextCount: bin.dominantTextCount, dominantTextSenders: bin.dominantTextSenders } : {}),
  }));
}

/** Local resumable observations; optional R2 copies contain counters only. */
export class LiveObservationStore {
  constructor({ root = getStorageRoot(), env = process.env, cloud } = {}) {
    this.directory = path.join(root, "live-observations"); this.env = env; this.cloud = cloud;
  }
  cloudStore() { if (this.cloud) return this.cloud; const config = readR2Config(this.env); return config ? new R2ObjectStore({ config }) : null; }
  async save({ id, source, bins, captureStatus = "UNKNOWN", chatStatus = "UNKNOWN" }, { archive = false } = {}) {
    if (!isProjectId(id)) throw new Error("La observación necesita un identificador válido.");
    const record = { id, version: 1, source: cleanSource(source), bins: cleanBins(bins), captureStatus, chatStatus, updatedAt: new Date().toISOString() };
    await mkdir(this.directory, { recursive: true });
    const file = path.join(this.directory, `${id}.json`), temporary = `${file}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(record), { mode: 0o600 }); await rename(temporary, file);
    let cloudSaved = false, cloudError = null;
    if (archive) {
      try { const cloud = this.cloudStore(); if (cloud) { await cloud.putJson(`${PREFIX}${record.source.channelId}/${record.source.sourceId}/${id}.json`, record); cloudSaved = true; } }
      catch { cloudError = "No se pudo guardar la observación en R2; los contadores locales se conservan."; }
    }
    return { record, cloudSaved, cloudError };
  }
  async loadForSource(source, { includeCloud = true } = {}) {
    cleanSource(source); await mkdir(this.directory, { recursive: true });
    const records = new Map(); let cloudError = null;
    const take = record => {
      if (record?.version === 1 && isProjectId(record.id) && sameLiveSource(record.source, source)) records.set(record.id, { ...record, bins: cleanBins(record.bins) });
    };
    const names = (await readdir(this.directory)).filter(n => /^[a-f0-9-]{36}\.json$/iu.test(n)).slice(-500);
    for (const name of names) { try { const bytes = await readFile(path.join(this.directory, name)); if (bytes.length <= 2 * 1024 * 1024) take(JSON.parse(bytes)); } catch { /* A damaged record does not erase the others. */ } }
    if (includeCloud) {
      try {
        const cloud = this.cloudStore();
        if (cloud) {
          const objects = (await cloud.list(`${PREFIX}${source.channelId}/`)).sort((a, b) => Date.parse(b.modified || 0) - Date.parse(a.modified || 0)).slice(0, 100);
          for (const item of objects) { const result = await cloud.getJson(item.key); if (result) take(result.value); }
        }
      } catch { cloudError = "No se pudieron recuperar las observaciones de R2; no se inventa actividad del chat."; }
    }
    return { bins: [...records.values()].flatMap(r => r.bins), recordIds: [...records.keys()], cloudError };
  }
}

export function alignChatToCapture(bins, capture, durationSeconds) {
  const ranges = (capture?.sourceRanges || []).filter(r => Number.isFinite(r.offsetSeconds) && Number.isFinite(Date.parse(r.sourceStartUtc))).sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const windows = [];
  for (let index = 0; index < ranges.length; index++) {
    const range = ranges[index], end = Math.min(durationSeconds, ranges[index + 1]?.offsetSeconds ?? durationSeconds);
    if (end <= range.offsetSeconds) continue;
    for (const window of buildChatActivityWindows(bins, { sourceStartUtc: range.sourceStartUtc, clockUncertaintySeconds: 10 })) {
      const start = Math.max(range.offsetSeconds, window.start + range.offsetSeconds);
      const finish = Math.min(end, window.end + range.offsetSeconds);
      if (finish > start) windows.push({ ...window, start, end: finish });
    }
  }
  return windows;
}
