import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { JobStore } from "../services/JobStore.mjs";
import { resolveKickSource } from "../services/live/KickPublicSourceService.mjs";
import { LiveObservationStore } from "../services/live/LiveObservationStore.mjs";
import { loadProjectFile, replaceProjectFile } from "../lib/project-files.mjs";
import { runMedia, validateMp4 } from "../services/media-processing/MediaValidationService.mjs";
import { ClipLibraryService } from "../services/storage/ClipLibraryService.mjs";

const argument = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (process.env.CLIPFORGE_RUN_EXTERNAL_MEDIA_TESTS !== "true" || !process.argv.includes("--rights-confirmed")) {
  throw new Error("Prueba externa optativa: requiere CLIPFORGE_RUN_EXTERNAL_MEDIA_TESTS=true y --rights-confirmed del operador autorizado.");
}
const url = argument("source");
if (!url || !/^https:\/\/kick\.com\/westcol(?:\/|$)/u.test(url)) throw new Error("Indica --source con un enlace autorizado de Westcol.");
const resume = argument("resume");
const acceptanceDirectory = path.resolve("artifacts", "kick-worker-acceptance");
const root = resume ? path.resolve(resume) : path.join(acceptanceDirectory, randomUUID());
if (path.dirname(root) !== acceptanceDirectory) throw new Error("La recuperación debe pertenecer a artifacts/kick-worker-acceptance.");
await mkdir(root, { recursive: true });
process.env.CLIPFORGE_STORAGE_DIR = root;
process.env.CLIPFORGE_ANALYSIS_PROVIDER = "heuristic";
for (const key of ["CLIPFORGE_AGENT_REAL_PUBLISHING", "CLIPFORGE_CONTENT_REAL_PUBLISHING", "CLIPFORGE_SMART_PUBLISH_ON_BOOT", "CLIPFORGE_AGENT_ENABLED"]) process.env[key] = "false";
const source = await resolveKickSource(url);
const observed = argument("observations");
if (observed && !resume) {
  const raw = JSON.parse(await readFile(path.resolve(observed), "utf8"));
  if (raw.channel !== "westcol" || !Array.isArray(raw.bins)) throw new Error("Las observaciones no corresponden al canal solicitado.");
  await new LiveObservationStore({ root }).save({ id: raw.projectId || randomUUID(), source: { ...source.metadata, sourceKind: "LIVE" }, bins: raw.bins,
    captureStatus: raw.capture ? "CAPTURED_UNVERIFIED" : "FAILED", chatStatus: "CLOSED" }, { archive: true });
}
const store = new IngestJobStore();
const prior = resume ? JSON.parse(await readFile(path.join(root, "evidence.json"), "utf8")) : null;
const job = prior ? await store.get(prior.jobId) : await store.create({ url, mode: "STREAM", captureSeconds: Number(argument("seconds") || 60), startTimeSeconds: Number(argument("start") || 0),
  segmentSeconds: 30, autoClip: true, clipMode: "CAPTURE", clipCount: 10, clipDuration: 30,
  contentProfile: "ENTERTAINMENT", subtitles: false, onlyChatReactions: true });
if (!job || job.source.url !== url) throw new Error("El trabajo recuperado no corresponde al enlace autorizado.");
const evidence = { simulated: false, realLlmCalled: false, analysisProvider: "heuristic", source: source.metadata, jobId: job.id, root, clips: [] };
const save = () => writeFile(path.join(root, "evidence.json"), JSON.stringify(evidence, null, 2));
try {
  if (job.status !== "COMPLETED") await runMedia(process.execPath, ["scripts/ingest-worker.mjs", "--once"], { timeoutMs: 15 * 60 * 1000 });
  const captured = await store.get(job.id); evidence.ingest = captured;
  if (captured.status !== "COMPLETED") throw new Error(`La ingesta terminó en ${captured.status}: ${captured.error || "sin medio"}`);
  const project = await loadProjectFile(job.id);
  evidence.captureValidation = await validateMp4(path.join(root, project.source.relativePath), { requireAudio: true });
  if (!project.liveObservation?.chatActivityWindows?.some(w => w.isCollectiveReaction || w.isPeak)) throw new Error("La captura es válida pero no tiene reacciones reales alineadas; no se inventan candidatos.");
  await save();
  const savedMediaJob = await new JobStore().get(captured.result.clipsJobId);
  if (savedMediaJob?.status !== "READY") await runMedia(process.execPath, ["scripts/media-worker.mjs", "--once"], { timeoutMs: 15 * 60 * 1000 });
  const mediaJob = await new JobStore().get(captured.result.clipsJobId); evidence.mediaJob = mediaJob;
  if (mediaJob.status !== "READY") throw new Error(`El editor terminó en ${mediaJob.status}: ${mediaJob.error || "sin clips"}`);
  const output = await loadProjectFile(mediaJob.projectId);
  for (const clip of output.clips || []) {
    const validation = await validateMp4(path.join(root, clip.render.relativePath), { requireAudio: true, duration: clip.duration, width: 1080, height: 1920 });
    let archive = null, archiveError = null;
    try { archive = await new ClipLibraryService().archive(output, clip); } catch (error) { archiveError = { code: error.code, message: error.message }; }
    clip.archive = archive;
    evidence.clips.push({ id: clip.id, title: clip.title, relativePath: clip.render.relativePath, duration: clip.duration, validation, archive, archiveError, editorialReview: clip.editorialReview });
  }
  await replaceProjectFile(output.id, output);
  evidence.status = "COMPLETED"; await save();
  console.log(JSON.stringify({ status: evidence.status, root, jobId: job.id, sourceDuration: evidence.captureValidation.duration, clips: evidence.clips.length }));
} catch (error) {
  evidence.status = "FAILED"; evidence.error = error.message; await save();
  console.log(JSON.stringify({ status: evidence.status, root, jobId: job.id, error: error.message })); process.exitCode = 1;
}
