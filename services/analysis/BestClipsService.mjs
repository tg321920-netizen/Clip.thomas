import { boundTranscriptSegments } from "../../lib/transcript-normalizer.mjs";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { transcribeProject } from "../transcription/TranscriptionService.mjs";
import { createContentAnalysisProvider } from "./createContentAnalysisProvider.mjs";
import { buildSubtitleTrack } from "../subtitles/SubtitleService.mjs";
import { RenderService } from "../clip/RenderService.mjs";
import { runMedia, validateMp4 } from "../media-processing/MediaValidationService.mjs";
import { WaitingResourceError } from "../owned-content/SceneStoryService.mjs";
import { measureAudioEnergy, measureSceneChanges, sentenceSegments } from "./AudioEnergyService.mjs";
import { sampleCandidateFingerprint } from "./VisualEvidenceService.mjs";
import { EditorialEventStore } from "./EditorialEventStore.mjs";

export class BestClipsService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.width = options.width || Number(this.env.CLIPFORGE_MEDIA_WIDTH || 1080);
    this.height = options.height || Number(this.env.CLIPFORGE_MEDIA_HEIGHT || 1920);
    this.provider = options.provider;
  }
  async render(outputProjectId, input, onStage = async () => {}) {
    let original = await loadProjectFile(input.projectId);
    if (!original) throw new Error("El video original no existe.");
    if (original.source?.captureValidation?.valid === false) throw new WaitingResourceError("La fuente fue rechazada durante la verificación de captura. Revisa el intervalo y vuelve a capturarlo.");
    const count = Number(input.count ?? 3), minDuration = Number(input.minDuration ?? 30), maxDuration = Number(input.maxDuration ?? 60), targetDuration = Number(input.targetDuration ?? ((minDuration + maxDuration) / 2));
    if (!Number.isSafeInteger(count) || count < 1 || count > 10 || !Number.isFinite(minDuration) || !Number.isFinite(maxDuration) || minDuration < 15 || minDuration > 180 || maxDuration < minDuration || maxDuration > 180) throw new Error("Elige entre uno y diez clips de 15 a 180 segundos.");
    if (!Number.isFinite(targetDuration) || targetDuration < minDuration || targetDuration > maxDuration) throw new Error("La duración aproximada debe estar dentro del intervalo permitido.");
    if (original.transcript?.status !== "COMPLETED") {
      try { await transcribeProject(input.projectId, { onProgress: async p => onStage("PROCESSING", "TRANSCRIBING", Math.round(p * 0.35)) }); original = await loadProjectFile(input.projectId); }
      catch (error) { if (/not installed|ENOENT|MODEL_PATH|required|not found/i.test(error.message)) throw new WaitingResourceError("Whisper no está configurado. Se necesita una transcripción real para elegir momentos y crear subtítulos."); throw error; }
    }
    await onStage("PROCESSING", "SELECTING", 35);
    const framingMode=String(input.framingMode||"CONVERSATION").toUpperCase();
    if(!["CONVERSATION","FILL","FIT"].includes(framingMode))throw new Error("Encuadre no válido.");
    const provider = this.provider || createContentAnalysisProvider({ env: this.env, providerName: input.analysisProvider });
    const checkpointKey = createHash("sha256").update(JSON.stringify({ input, width: this.width, height: this.height,
      transcript: original.transcript, chatActivityWindows: original.liveObservation?.chatActivityWindows || [], continuityBreaks: original.source.capture?.continuityBreaks || [], provider: provider.name, model: provider.model || null, vision: provider.visionEnabled === true })).digest("hex");
    const previous = await loadProjectFile(outputProjectId);
    const matching = previous?.clipsOrigin?.checkpointKey === checkpointKey;
    let candidates = matching ? previous.analysis?.candidates : null;
    if (!candidates?.length) {
      const audioEnergyWindows = await measureAudioEnergy(resolveStoragePath(original.source.relativePath));
      const sceneChanges = await measureSceneChanges(resolveStoragePath(original.source.relativePath));
      const selectionTranscript = { ...original.transcript, segments: sentenceSegments(boundTranscriptSegments(original.transcript.segments, original.source.durationSeconds)) };
      try {
        candidates = await provider.analyze({ project: original, transcript: selectionTranscript, audioEnergyWindows, sceneChanges,
          chatActivityWindows: original.liveObservation?.chatActivityWindows || [],
          options: { minDuration, maxDuration, targetDuration, maxCandidates: provider.strictSelection ? Math.min(12, count + 3) : 50, requireCompleteSentences: true, contentProfile: input.contentProfile,
            requireChatReaction: input.onlyChatReactions === true, continuityBreaks: original.source.capture?.continuityBreaks || [] } });
      } catch (error) {
        if (provider.name !== "transcript-heuristic-v2" && error.retryable !== true) throw new WaitingResourceError(`No se pudo completar la selección con IA: ${error.message}`);
        throw error;
      }
    }
    const independent = selectIndependentClips(candidates, { count: 50, minDuration, maxDuration,
      onlyChatReactions: input.onlyChatReactions === true, excludedReactionPeaks: input.excludedReactionPeaks || [],
      sourceEnd: Math.min(original.source.durationSeconds, original.source.audioDurationSeconds || Infinity, original.source.videoDurationSeconds || Infinity),
      ownershipStartUtc: original.source.capture?.ownershipStartUtc, ownershipEndUtc: original.source.capture?.ownershipEndUtc,
      continuityBreaks: original.source.capture?.continuityBreaks || [], continuityIntervals:original.source.capture?.continuityIntervals || [] });
    const eventStore=new EditorialEventStore(), eventSource=original.liveObservation?.source, selected=[];
    for(const candidate of independent){
      if(eventSource && selected.length<count){try{candidate.visualFingerprint=await sampleCandidateFingerprint(original,candidate);}catch{candidate.visualFingerprint=null;}}
      if(await eventStore.reserve(eventSource,candidate,outputProjectId))selected.push(candidate);if(selected.length>=count)break;
    }
    if (selected.length === 0) throw new WaitingResourceError("No se encontraron momentos completos y diferentes dentro de esos límites. Ajusta la duración o revisa la transcripción.");
    const selectionWarning = selected.length < count
      ? `Se prepararon ${selected.length} de ${count} clips solicitados: no se encontraron más momentos completos y diferentes dentro de esos límites.` : null;
    const reusable = matching ? previous.clips || [] : [];
    const now = new Date().toISOString();
    const project = { id: outputProjectId, createdAt: previous?.createdAt || now, source: { ...original.source, projectId: outputProjectId, posterUrl: `/api/projects/${outputProjectId}/poster`, sourceUrl: `/api/projects/${outputProjectId}/source` }, transcript: original.transcript, liveObservation:original.liveObservation || null, analysis: { id: randomUUID(), status: "COMPLETED", candidates: selected, provider: provider.name, model: provider.model || null, completedAt: now }, clips: [...reusable], clipsOrigin: { projectId: original.id, method: "TRANSCRIPT_BOUNDARIES", realViewStatistics: false, checkpointKey, requestedCount: count, selectedCount: selected.length, selectionWarning, deliveryComplete: false } };
    // Persist the editorial decision before encoding so a restart does not call the model again.
    await replaceProjectFile(outputProjectId, project);
    const results = [];
    for (const candidate of selected) {
      const saved = reusable.find(clip => clip.status === "READY" && clip.startTime === candidate.startTime && clip.endTime === candidate.endTime);
      let recovered = null;
      if (saved?.render?.relativePath) {
        try {
          await validateMp4(resolveStoragePath(saved.render.relativePath), { width: this.width, height: this.height, duration: saved.duration, requireAudio: original.source.hasAudio !== false });
          recovered = saved;
        } catch { /* An invalid cached render must be rebuilt. */ }
      }
      const clip = recovered || { id: randomUUID(), projectId: outputProjectId, candidateId: candidate.id, startTime: candidate.startTime, endTime: candidate.endTime, duration: candidate.duration, status: "PROCESSING", edit: { framingMode, ...(input.focusX===undefined?{}:{focusX:Number(input.focusX)}), motionIntensity:input.intensity||"GENTLE", subtitlesEnabled: input.subtitles !== false, subtitleStyle: "CLEAN", quality: "BALANCED" }, title: candidate.title, reason: candidate.reason, aiAssessment: candidate.aiAssessment || null, editorialReview: { status: "PENDING", analysisKind: candidate.aiAssessment ? "MODEL_SELECTION" : "LOCAL_HEURISTIC", boundaryEvidence: "TRANSCRIPT_PUNCTUATION" }, createdAt: now, updatedAt: now, error: null };
      if (!recovered && input.subtitles !== false) clip.subtitles = buildSubtitleTrack({ transcript: original.transcript, clip, style: "CLEAN" });
      try{if (!recovered) clip.render = await new RenderService({ width: this.width, height: this.height }).renderClip({ project, clip }); clip.status = "READY";}
      catch(error){await eventStore.release(eventSource,outputProjectId);throw error;}
      project.clips = project.clips.filter(item => item.startTime !== clip.startTime || item.endTime !== clip.endTime);
      project.clips.push(clip);
      await replaceProjectFile(outputProjectId, project);
      await eventStore.confirm(eventSource,candidate.id,outputProjectId);
      results.push({ clipId: clip.id, title: candidate.title, duration: clip.duration, startTime: clip.startTime, endTime: clip.endTime, reason: candidate.reason, aiAssessment: clip.aiAssessment || null, editorialReview: clip.editorialReview, sourceUrl: clip.render.sourceUrl, downloadUrl: `${clip.render.sourceUrl}?download=1`, relativePath: clip.render.relativePath, validation: clip.render.validation });
      await onStage("PROCESSING", "RENDERING_CLIPS", 35 + Math.round(results.length / selected.length * 55));
    }
    await onStage("VALIDATING", "MEDIA_VALIDATION", 95);
    const posters = path.join(getStorageRoot(), "uploads", outputProjectId); await mkdir(posters, { recursive: true });
    try { await copyFile(resolveStoragePath(path.posix.join("uploads", original.id, "poster.jpg")), path.join(posters, "poster.jpg")); }
    catch { await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", resolveStoragePath(results[0].relativePath), "-frames:v", "1", path.join(posters, "poster.jpg")]); }
    project.clipsOrigin.deliveryComplete = true;
    await replaceProjectFile(outputProjectId, project);
    return { projectId: outputProjectId, clips: results, requestedCount: count, actualCount: results.length, warnings: selectionWarning ? [selectionWarning] : [], validation: { valid: results.every(r => r.validation?.valid), checkedAt: new Date().toISOString(), clipCount: results.length, distinct: true }, title: `Clips de ${original.source.originalName}` };
  }
}

/** Preserve the rescue branch's finite, non-overlapping candidate validation. */
export function selectIndependentClips(candidates, { count, minDuration, maxDuration, sourceEnd = Infinity, onlyChatReactions = false, ownershipStartUtc, ownershipEndUtc, excludedReactionPeaks = [], continuityBreaks = [], continuityIntervals = [] }) {
  const selected = [];
  for (const candidate of candidates) {
    if (!Number.isFinite(candidate?.startTime) || !Number.isFinite(candidate?.endTime) ||
        !Number.isFinite(candidate?.duration) || candidate.endTime <= candidate.startTime ||
        candidate.duration < minDuration || candidate.duration > maxDuration ||
        Math.abs(candidate.duration - (candidate.endTime - candidate.startTime)) > 0.05 ||
        candidate.startTime < 0 || candidate.endTime > sourceEnd ||
        continuityBreaks.some(t => Number.isFinite(t) && candidate.startTime < t && candidate.endTime > t) ||
        continuityIntervals.some(g=>candidate.startTime<g.end&&candidate.endTime>g.start)) continue;
    if (selected.some(existing => Math.min(existing.endTime, candidate.endTime) > Math.max(existing.startTime, candidate.startTime))) continue;
    const reaction = candidate.chatEvidence;
    if (ownershipStartUtc && (!Number.isFinite(Date.parse(reaction?.peakUtc)) || Date.parse(reaction.peakUtc)<Date.parse(ownershipStartUtc) || Date.parse(reaction.peakUtc)>=Date.parse(ownershipEndUtc))) continue;
    if (onlyChatReactions && (!(reaction?.isCollectiveReaction || reaction?.isPeak) || !Number.isFinite(reaction?.score) || reaction.score < 25)) continue;
    if (excludedReactionPeaks.some(time => Number.isFinite(Date.parse(time)) && Math.abs(Date.parse(time) - Date.parse(reaction?.peakUtc)) < 30000)) continue;
    if ((reaction?.isCollectiveReaction || reaction?.isPeak) && selected.some(existing => {
      const other = existing.chatEvidence;
      return (other?.isCollectiveReaction || other?.isPeak) && Number.isFinite(Date.parse(reaction.peakUtc)) &&
        Math.abs(Date.parse(other.peakUtc) - Date.parse(reaction.peakUtc)) < 30000;
    })) continue;
    selected.push(candidate);
    if (selected.length >= count) break;
  }
  return selected;
}

