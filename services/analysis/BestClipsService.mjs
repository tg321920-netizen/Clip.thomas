import { randomUUID } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { transcribeProject } from "../transcription/TranscriptionService.mjs";
import { TranscriptCandidateProvider } from "./TranscriptCandidateProvider.mjs";
import { buildSubtitleTrack } from "../subtitles/SubtitleService.mjs";
import { RenderService } from "../clip/RenderService.mjs";
import { runMedia } from "../media-processing/MediaValidationService.mjs";
import { WaitingResourceError } from "../owned-content/SceneStoryService.mjs";
import { measureAudioEnergy, sentenceSegments } from "./AudioEnergyService.mjs";

export class BestClipsService {
  constructor(options = {}) { this.width = options.width || 1080; this.height = options.height || 1920; }
  async render(outputProjectId, input, onStage = async () => {}) {
    let original = await loadProjectFile(input.projectId);
    if (!original) throw new Error("El video original no existe.");
    const count = Number(input.count || 3), minDuration = Number(input.minDuration || 90), maxDuration = Number(input.maxDuration || 180);
    if (!Number.isSafeInteger(count) || count < 1 || count > 10 || !Number.isFinite(minDuration) || !Number.isFinite(maxDuration) || minDuration < 15 || minDuration > 120 || maxDuration < minDuration || maxDuration > 180) throw new Error("Elige entre uno y diez clips de 15 a 180 segundos.");
    if (original.transcript?.status !== "COMPLETED") {
      try { await transcribeProject(input.projectId, { onProgress: async p => onStage("PROCESSING", "TRANSCRIBING", Math.round(p * 0.35)) }); original = await loadProjectFile(input.projectId); }
      catch (error) { if (/not installed|ENOENT|MODEL_PATH|required|not found/i.test(error.message)) throw new WaitingResourceError("Whisper no está configurado. Se necesita una transcripción real para elegir momentos y crear subtítulos."); throw error; }
    }
    await onStage("PROCESSING", "SELECTING", 35);
    const audioEnergyWindows = await measureAudioEnergy(resolveStoragePath(original.source.relativePath));
    const selectionTranscript = { ...original.transcript, segments: sentenceSegments(original.transcript.segments) };
    const candidates = await new TranscriptCandidateProvider().analyze({ transcript: selectionTranscript, audioEnergyWindows, options: { minDuration, maxDuration, targetDuration: (minDuration + maxDuration) / 2, maxCandidates: 50 } });
    const selected = [];
    for (const candidate of candidates) {
      if (candidate.duration < minDuration || candidate.duration > maxDuration) continue;
      if (selected.some(s => Math.min(s.endTime, candidate.endTime) > Math.max(s.startTime, candidate.startTime))) continue;
      selected.push(candidate); if (selected.length === count) break;
    }
    if (selected.length !== count) throw new WaitingResourceError(`Se encontraron ${selected.length} momentos completos y diferentes dentro de esos límites. Reduce la cantidad o ajusta la duración.`);
    const now = new Date().toISOString();
    const project = { id: outputProjectId, createdAt: now, source: { ...original.source, projectId: outputProjectId, posterUrl: `/api/projects/${outputProjectId}/poster`, sourceUrl: `/api/projects/${outputProjectId}/source` }, transcript: original.transcript, analysis: { id: randomUUID(), status: "COMPLETED", candidates: selected, provider: "transcript-heuristic-v2", completedAt: now }, clips: [], clipsOrigin: { projectId: original.id, method: "TRANSCRIPT_BOUNDARIES", realViewStatistics: false } };
    const results = [];
    for (const candidate of selected) {
      const clip = { id: randomUUID(), projectId: outputProjectId, candidateId: candidate.id, startTime: candidate.startTime, endTime: candidate.endTime, duration: candidate.duration, status: "PROCESSING", edit: { framingMode: "FIT", motionIntensity:input.intensity||"NORMAL", subtitlesEnabled: input.subtitles !== false, subtitleStyle: "CLEAN", quality: "FAST" }, title: candidate.title, reason: candidate.reason, createdAt: now, updatedAt: now, error: null };
      if (input.subtitles !== false) clip.subtitles = buildSubtitleTrack({ transcript: original.transcript, clip, style: "CLEAN" });
      clip.render = await new RenderService({ width: this.width, height: this.height }).renderClip({ project, clip }); clip.status = "READY";
      project.clips.push(clip);
      results.push({ clipId: clip.id, title: candidate.title, duration: clip.duration, startTime: clip.startTime, endTime: clip.endTime, reason: candidate.reason, sourceUrl: clip.render.sourceUrl, downloadUrl: `${clip.render.sourceUrl}?download=1`, relativePath: clip.render.relativePath, validation: clip.render.validation });
      await onStage("PROCESSING", "RENDERING_CLIPS", 35 + Math.round(results.length / count * 55));
    }
    await onStage("VALIDATING", "MEDIA_VALIDATION", 95);
    await replaceProjectFile(outputProjectId, project);
    const posters = path.join(getStorageRoot(), "uploads", outputProjectId); await mkdir(posters, { recursive: true });
    try { await copyFile(resolveStoragePath(path.posix.join("uploads", original.id, "poster.jpg")), path.join(posters, "poster.jpg")); }
    catch { await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", resolveStoragePath(results[0].relativePath), "-frames:v", "1", path.join(posters, "poster.jpg")]); }
    return { projectId: outputProjectId, clips: results, validation: { valid: results.every(r => r.validation?.valid), checkedAt: new Date().toISOString(), clipCount: results.length, distinct: true }, title: `Clips de ${original.source.originalName}` };
  }
}
