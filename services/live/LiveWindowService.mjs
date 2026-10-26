import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { LiveSessionStore, liveId } from "./LiveSessionStore.mjs";
import { LiveObservationStore, alignChatToCapture } from "./LiveObservationStore.mjs";
import { IngestJobStore } from "../ingest/IngestJobStore.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { hashFile } from "../ingest/ResumableUploadStore.mjs";
import { ingestUrlJob, queueCapturedBatch } from "../ingest/UrlIngestService.mjs";
import { runMedia, probeMediaFile } from "../media-processing/MediaValidationService.mjs";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { JobStore } from "../JobStore.mjs";

export async function inspectLiveSegment(file, { signal } = {}) {
  const { video, audio, duration } = await probeMediaFile(file);
  if (!video || !audio || !(duration > 0)) throw Object.assign(new Error("El segmento no conserva vídeo y audio verificables."), { code: "LIVE_SEGMENT_INVALID" });
  await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v","error","-threads","1","-xerror","-i",file,"-map","0:v:0","-map","0:a:0","-f","null","-"], { signal });
  const gaps = [];
  for (const track of ["v:0", "a:0"]) {
    const { stdout } = await runMedia(process.env.FFPROBE_PATH || "ffprobe", ["-v","error","-select_streams",track,"-show_packets","-show_entries","packet=dts_time,duration_time","-of","csv=p=0",file], { signal });
    let previousEnd = null, origin = null;
    for (const line of stdout.split("\n")) {
      const [raw, rawDuration] = line.split(","), time = Number(raw), length = Number(rawDuration);
      if (!raw?.trim() || !Number.isFinite(time)) continue;
      origin ??= time;
      if (previousEnd !== null && time - previousEnd > 0.5) gaps.push({ track, start: previousEnd - origin, end: time - origin });
      previousEnd = time + (Number.isFinite(length) ? length : 0);
    }
  }
  return { valid: true, fullDecode: true, hasAudio: true, durationSeconds: duration, width: video.width, height: video.height, packetGaps: gaps, checkedAt: new Date().toISOString() };
}

/** Bounded materialization queue. Capture only journals originals; this function
 * can run while FFmpeg is writing the next segment, regardless of editor/R2. */
export async function enqueueReadyLiveWindows(sessionId, { sessions = new LiveSessionStore(), jobs = new IngestJobStore(), mediaJobs = new JobStore(), observations = new LiveObservationStore(), maxPending = 6, onlyChatReactions = true } = {}) {
  const state = await sessions.get(sessionId); if (!state) return;
  const loaded = await observations.loadForSource(state.source, { includeCloud: false });
  const available = state.segments.filter(s => s.status === "CAPTURED");
  const inflight = await Promise.all(state.windows.map(w => jobs.get(w.jobId)));
  const downstream = await Promise.all(inflight.filter(j=>j?.result?.clipsJobId).map(j=>mediaJobs.get(j.result.clipsJobId)));
  let pending = inflight.filter(j => j && !["COMPLETED","FAILED","CANCELLED"].includes(j.status)).length + downstream.filter(j=>j && !["READY","WAITING_RESOURCE","FAILED","CANCELLED"].includes(j.status)).length;
  for (let i = 0; i < available.length; i++) {
    const core = available[i];
    if (state.windows.some(w => w.coreIndex === core.index)) continue;
    if (!available[i+1] && ["QUEUED","CAPTURING","RECOVERING"].includes(state.capture.status)) break;
    if (pending >= maxPending) break;
    const refs = available.slice(Math.max(0,i-1), i+2), first = refs[0];
    const windows = first.sourceStartUtc ? alignChatToCapture(loaded.bins, { sourceRanges: [{ offsetSeconds: 0, sourceStartUtc: first.sourceStartUtc }] }, refs.reduce((n,s) => n+s.durationSeconds,0)) : [];
    const priority = Math.max(0,...windows.map(w => w.score || 0));
    const ownershipEndUtc = Number.isFinite(Date.parse(core.sourceStartUtc)) ? new Date(Date.parse(core.sourceStartUtc)+core.durationSeconds*1000).toISOString() : null;
    const id = liveId(`${sessionId}:window:${core.index}`);
    await jobs.enqueueLiveWindow({ id, sessionId, coreIndex: core.index, segmentIndices: refs.map(s => s.index), priority,
      ownershipStartUtc: core.sourceStartUtc, ownershipEndUtc, onlyChatReactions });
    await sessions.update(sessionId, s => { if (!s.windows.some(w => w.jobId === id)) s.windows.push({ jobId: id, coreIndex: core.index, priority, status: "QUEUED" }); });
    pending++;
  }
  return { pending, deferred: Math.max(0, available.length - (await sessions.get(sessionId)).windows.length) };
}

export async function materializeLiveWindow(job, { signal, onProgress = async () => {}, sessions = new LiveSessionStore(), observations = new LiveObservationStore() } = {}) {
  const session = await sessions.get(job.source.sessionId);
  if (!session) throw Object.assign(new Error("Falta el manifiesto de originales."), { code: "LIVE_STATE_MISSING" });
  const segments = job.source.segmentIndices.map(i => session.segments.find(s => s.index === i));
  if (segments.some(s => !s || s.status !== "CAPTURED")) throw new Error("La ventana contiene un segmento inválido o ausente.");
  const directory = path.join(getStorageRoot(), "uploads", job.projectId); await mkdir(directory, { recursive: true });
  const ranges = [], continuityBreaks = [], continuityIntervals = []; let offset = 0, previousEnd = null;
  for (const segment of segments) {
    signal?.throwIfAborted();
    const file = resolveStoragePath(segment.relativePath);
    if ((await stat(file)).size !== segment.sizeBytes || await hashFile(file) !== segment.sha256) throw new Error("El original no coincide con su SHA-256; se conserva sin usarlo.");
    const validation = segment.validation?.valid ? segment.validation : await inspectLiveSegment(file, { signal });
    await sessions.validateSegment(session.id,segment.index,validation);
    for (const gap of validation.packetGaps) { continuityBreaks.push(offset+gap.start,offset+gap.end); continuityIntervals.push({start:offset+gap.start,end:offset+gap.end}); }
    if (previousEnd !== null && (!segment.sourceStartUtc || Math.abs(Date.parse(segment.sourceStartUtc)-previousEnd)>1000)) continuityBreaks.push(offset);
    if (segment.sourceStartUtc) ranges.push({ offsetSeconds: offset, sourceStartUtc: segment.sourceStartUtc });
    previousEnd = segment.sourceStartUtc ? Date.parse(segment.sourceStartUtc)+segment.durationSeconds*1000 : null;
    offset += segment.durationSeconds;
  }
  await onProgress(25,"ASSEMBLING_CONTEXT");
  const concat = path.join(directory,"live-context.txt"), media = path.join(directory,"source.mp4");
  await writeFile(concat, segments.map(s=>`file '${resolveStoragePath(s.relativePath)}'`).join("\n")+"\n");
  await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v","error","-y","-f","concat","-safe","0","-i",concat,"-c","copy","-bsf:a","aac_adtstoasc","-movflags","+faststart",media], { signal });
  const upload = { ...job, source: { mode: "UPLOAD", relativePath: path.posix.join("uploads",job.projectId,"source.mp4"), filename: `${session.source.channel || "owned"}-contexto.mp4`, size: (await stat(media)).size, sha256: await hashFile(media) } };
  const result = await ingestUrlJob(upload, { signal, onProgress });
  const project = await loadProjectFile(job.projectId), saved = await observations.loadForSource(session.source, { includeCloud: false });
  project.source.capture = { sessionId: session.id, sourceRanges: ranges, continuityBreaks, continuityIntervals, ownershipStartUtc: job.source.ownershipStartUtc, ownershipEndUtc: job.source.ownershipEndUtc };
  project.source.captureValidation = { valid: true, fullDecode: true, rawSegmentCount: segments.length };
  project.liveObservation = { source: session.source, channel: session.source.channel, chatStatus: session.chat.status,
    chatActivityWindows: alignChatToCapture(saved.bins, { sourceRanges: ranges }, project.source.durationSeconds), clockUncertaintySeconds: 10 };
  await replaceProjectFile(project.id, project);
  const clips = await queueCapturedBatch({ projectId: project.id, job });
  await sessions.update(session.id, s=>{ const window=s.windows.find(w=>w.jobId===job.id); if(window){window.status="MATERIALIZED";window.projectId=project.id;window.clipsJobId=clips.id;} });
  return { ...result, clipsJobId: clips.id, sessionId: session.id, originalSegmentsPreserved: true };
}
