import { boundTranscriptSegments } from "../../lib/transcript-normalizer.mjs";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { loadProjectFile, replaceProjectFile, updateProjectFile, listProjectFiles } from "../../lib/project-files.mjs";
import { hashFile } from '../ingest/ResumableUploadStore.mjs';
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { transcribeProject } from "../transcription/TranscriptionService.mjs";
import { createContentAnalysisProvider } from "./createContentAnalysisProvider.mjs";
import { buildSubtitleTrack, prepareSubtitleTrack, rememberSubtitleVersion, SUBTITLE_MODES } from "../subtitles/SubtitleService.mjs";
import { RenderService } from "../clip/RenderService.mjs";
import { runMedia, validateMp4 } from "../media-processing/MediaValidationService.mjs";
import { WaitingResourceError } from "../owned-content/SceneStoryService.mjs";
import { measureAudioEnergy, measureSceneChanges, sentenceSegments } from "./AudioEnergyService.mjs";
import { sampleCandidateFingerprint } from "./VisualEvidenceService.mjs";
import { EditorialEventStore } from "./EditorialEventStore.mjs";
import { LocalTranslationProvider } from "../subtitles/LocalTranslationProvider.mjs";
import { clipResult } from '../clip/ClipResult.mjs';
import { withLocalStateLock } from '../../lib/atomic-local-state.mjs';
import { isProjectId } from '../../lib/project-id.mjs';

export class BestClipsService {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.width = options.width || Number(this.env.CLIPFORGE_MEDIA_WIDTH || 1080);
    this.height = options.height || Number(this.env.CLIPFORGE_MEDIA_HEIGHT || 1920);
    this.provider = options.provider;
  }
  async render(outputProjectId, input, onStage = async () => {}) {
    if (!isProjectId(outputProjectId)) throw new Error('Identificador de lote inválido.');
    return withLocalStateLock(path.join(getStorageRoot(), 'clips', outputProjectId, 'batch-state'),
      () => this.renderUnlocked(outputProjectId, input, onStage), { timeoutMs: 1000, staleMs: 0 });
  }
  async renderUnlocked(outputProjectId, input, onStage) {
    let original = await loadProjectFile(input.projectId);
    if (!original) throw new Error("El video original no existe.");
    const previous = await loadProjectFile(outputProjectId);
    if (previous && previous.clipsOrigin?.projectId !== original.id) throw new WaitingResourceError('El lote guardado pertenece a otra fuente. Inicia un lote nuevo; no se modificaron sus recortes.');
    if (input.subtitleMode !== undefined && !SUBTITLE_MODES.includes(input.subtitleMode)) throw new Error("Modo de subtítulos inválido.");
    if (input.subtitleMode === "TRANSLATE_ES") {
      try { new LocalTranslationProvider({ env: this.env }).assertConfigured(); }
      catch (error) { throw new WaitingResourceError(error.message); }
    }
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
    const matching = previous?.clipsOrigin?.checkpointKey === checkpointKey;
    if (previous && !matching) throw new WaitingResourceError('Los ajustes, la transcripción o el proveedor del lote cambiaron. Se conservó el lote anterior; inicia uno nuevo para analizar con esa configuración.');
    let candidates = matching ? previous.analysis?.candidates : null;
    if (!candidates?.length) {
      const audioEnergyWindows = await measureAudioEnergy(resolveStoragePath(original.source.relativePath));
      const sceneChanges = original.source.mediaKind === 'AUDIO' ? null : await measureSceneChanges(resolveStoragePath(original.source.relativePath));
      const selectionTranscript = { ...original.transcript, segments: sentenceSegments(boundTranscriptSegments(original.transcript.segments, original.source.durationSeconds)) };
      try {
        candidates = await provider.analyze({ project: original, transcript: selectionTranscript, audioEnergyWindows, sceneChanges,
          chatActivityWindows: original.liveObservation?.chatActivityWindows || [],
          options: { minDuration, maxDuration, targetDuration, maxCandidates: provider.strictSelection ? Math.min(12, count + 3) : 50, requireCompleteSentences: true, contentProfile: input.contentProfile,
            requireChatReaction: input.onlyChatReactions === true, preferChatReactions: input.preferChatReactions === true, requireAvEvidence: input.preferChatReactions === true,
            chatReactionLagSeconds: input.chatReactionLagSeconds || 0, continuityBreaks: original.source.capture?.continuityBreaks || [] } });
      } catch (error) {
        if (!/^transcript-heuristic-v\d+$/.test(provider.name) && error.retryable !== true) throw new WaitingResourceError(`No se pudo completar la selección con IA: ${error.message}`);
        throw error;
      }
    }
    const independent = selectIndependentClips(candidates, { count: 50, minDuration, maxDuration,
      onlyChatReactions: input.onlyChatReactions === true, excludedReactionPeaks: input.excludedReactionPeaks || [],
      sourceEnd: Math.min(original.source.durationSeconds, original.source.audioDurationSeconds || Infinity, original.source.videoDurationSeconds || Infinity),
      ownershipStartUtc: original.source.capture?.ownershipStartUtc, ownershipEndUtc: original.source.capture?.ownershipEndUtc,
      sourceRanges: original.source.capture?.sourceRanges || [],
      continuityBreaks: original.source.capture?.continuityBreaks || [], continuityIntervals:original.source.capture?.continuityIntervals || [] });
    const eventStore=new EditorialEventStore(), sourceSha256 = original.liveObservation?.source ? null : await hashFile(resolveStoragePath(original.source.relativePath));
    const eventSource=original.liveObservation?.source || {channelId:'FILE',sourceId:sourceSha256,sourceKind:'FILE'}, selected=[];
    if (sourceSha256) await eventStore.recoverFileProjects(eventSource, await listProjectFiles(1000,{mapProject:p=>({id:p.id,createdAt:p.createdAt,clipsOrigin:p.clipsOrigin,
      analysis:{candidates:p.analysis?.candidates||[]},clips:(p.clips||[]).map(c=>({candidateId:c.candidateId,startTime:c.startTime,endTime:c.endTime,status:c.status,render:{validation:c.render?.validation}}))})}));
    for(const candidate of independent){
      if(eventSource && original.source.mediaKind!=='AUDIO' && selected.length<count){try{candidate.visualFingerprint=await sampleCandidateFingerprint(original,candidate);}catch{candidate.visualFingerprint=null;}}
      if(await eventStore.reserve(eventSource,candidate,outputProjectId))selected.push(candidate);if(selected.length>=count)break;
    }
    if (selected.length === 0) throw new WaitingResourceError("No se encontraron momentos completos y diferentes dentro de esos límites. Ajusta la duración o revisa la transcripción.");
    const selectionWarning = selected.length < count
      ? `Se prepararon ${selected.length} de ${count} clips solicitados: no se encontraron más momentos completos y diferentes dentro de esos límites.` : null;
    const reusable = matching ? previous.clips || [] : [];
    const now = new Date().toISOString();
    const project = { id: outputProjectId, createdAt: previous?.createdAt || now, translationSettings: previous?.translationSettings || original.translationSettings, source: { ...original.source, projectId: outputProjectId, posterUrl: `/api/projects/${outputProjectId}/poster`, sourceUrl: `/api/projects/${outputProjectId}/source` }, transcript: original.transcript, liveObservation:original.liveObservation || null, analysis: { id: randomUUID(), status: "COMPLETED", candidates: selected, provider: provider.name, model: provider.model || null, completedAt: now }, clips: [...reusable], clipsOrigin: { projectId: original.id, method: "TRANSCRIPT_BOUNDARIES", realViewStatistics: false, checkpointKey, requestedCount: count, selectedCount: selected.length, selectionWarning, deliveryComplete: false } };
    // Persist the editorial decision before encoding so a restart does not call the model again.
    if (sourceSha256) project.clipsOrigin.sourceSha256=sourceSha256;
    if (previous) await updateProjectFile(outputProjectId, current => {
      current.analysis = project.analysis;
      current.clipsOrigin = project.clipsOrigin;
    });
    else await replaceProjectFile(outputProjectId, project);
    const results = [];
    for (const candidate of selected) {
      const saved = reusable.find(clip => clip.candidateId === candidate.id && clip.startTime === candidate.startTime && clip.endTime === candidate.endTime);
      if (saved && ['QUEUED', 'RENDERING'].includes(saved.status)) throw new WaitingResourceError('Este recorte tiene otro render pendiente. Espera a que termine antes de reanudar el lote.');
      let recovered = null;
      if (saved?.status === 'READY' && saved?.render?.relativePath) {
        try {
          await validateMp4(resolveStoragePath(saved.render.relativePath), { width: this.width, height: this.height, duration: saved.duration, requireAudio: original.source.hasAudio !== false, audioOnly: original.source.mediaKind === 'AUDIO' });
          recovered = saved;
        } catch { /* An invalid cached render must be rebuilt. */ }
      }
      let clip = recovered || (saved ? structuredClone(saved) : { id: randomUUID(), projectId: outputProjectId, candidateId: candidate.id, startTime: candidate.startTime, endTime: candidate.endTime, duration: candidate.duration, status: "PROCESSING", edit: { framingMode, ...(input.focusX===undefined?{}:{focusX:Number(input.focusX)}), motionIntensity:input.intensity||"GENTLE", subtitlesEnabled: input.subtitles !== false, subtitleStyle: "CLEAN", quality: "BALANCED" }, title: candidate.title, reason: candidate.reason, aiAssessment: candidate.aiAssessment || null, editorialReview: { status: "PENDING", analysisKind: candidate.aiAssessment ? "MODEL_SELECTION" : "LOCAL_HEURISTIC", detectionBasis: (candidate.chatEvidence?.isPeak || candidate.chatEvidence?.isCollectiveReaction) && candidate.chatEvidence.score >= 25 ? "OBSERVED_CHAT_AND_AV" : "AV_ONLY", boundaryEvidence: "TRANSCRIPT_PUNCTUATION" }, createdAt: now, updatedAt: now, error: null });
      try {
      if (!recovered) {
        const expectedEdit = editingKey(clip);
        clip = await updateProjectFile(outputProjectId, current => {
          const latest = current.clips?.find(item => item.id === clip.id);
          if (saved && (!latest || editingKey(latest) !== expectedEdit || latest.status !== saved.status)) throw new WaitingResourceError('La edición cambió mientras se reanudaba. Se conservan las correcciones; vuelve a intentar el lote.');
          const processing = { ...clip, ...latest, status: 'PROCESSING', error: null, updatedAt: new Date().toISOString() };
          current.clips = (current.clips || []).filter(item => item.id !== processing.id);
          current.clips.push(processing);
          return structuredClone(processing);
        });
        if (!saved && input.subtitleMode !== undefined) {
          clip.edit.subtitleMode = input.subtitleMode;
          clip.edit.subtitlesEnabled = input.subtitleMode !== 'NONE';
        }
        if (clip.edit.subtitleMode && clip.edit.subtitlesEnabled) {
          const track = await prepareSubtitleTrack(original, clip, { translator: new LocalTranslationProvider({ env: this.env }) });
          if (clip.subtitles && track !== clip.subtitles) rememberSubtitleVersion(clip, 'AUTOMATIC_REGENERATED');
          clip.subtitles = track;
          if (clip.edit.subtitleRegenerate === true) clip.edit.subtitleRegenerate = false;
        } else if (!saved && input.subtitles !== false && input.subtitleMode === undefined) {
          clip.subtitles = buildSubtitleTrack({ transcript: original.transcript, clip, style: 'CLEAN' });
        }
        await updateProjectFile(outputProjectId, current => {
          const latest = current.clips.find(item => item.id === clip.id);
          if (!latest || latest.status !== 'PROCESSING') throw new WaitingResourceError('El estado del recorte cambió. Se conservan los archivos para reintentar.');
          latest.edit = clip.edit; latest.subtitles = clip.subtitles;
          if (clip.subtitleHistory) latest.subtitleHistory = clip.subtitleHistory;
        });
        clip.render = await new RenderService({ width: this.width, height: this.height }).renderClip({ project, clip });
        const encodedEdit = editingKey(clip);
        clip = await updateProjectFile(outputProjectId, current => {
          const latest = current.clips.find(item => item.id === clip.id);
          if (!latest || latest.status !== 'PROCESSING' || editingKey(latest) !== encodedEdit) throw new WaitingResourceError('La edición cambió durante el render. No se marcó como terminado un archivo de otra revisión.');
          Object.assign(latest, { render: clip.render, status: 'READY', error: null, updatedAt: new Date().toISOString() });
          return structuredClone(latest);
        });
      }
      } catch(error){
        await updateProjectFile(outputProjectId, current => {
          const latest = current.clips?.find(item => item.id === clip.id);
          if (latest?.status === 'PROCESSING') Object.assign(latest, { status: 'FAILED', error: 'El procesamiento se interrumpió. El original y los subtítulos guardados se conservan para reintentar.', updatedAt: new Date().toISOString() });
        });
        await eventStore.release(eventSource,outputProjectId);throw error;
      }
      project.clips = project.clips.filter(item => item.startTime !== clip.startTime || item.endTime !== clip.endTime);
      project.clips.push(clip);
      await eventStore.confirm(eventSource,candidate.id,outputProjectId);
      results.push(clipResult(project, clip));
      await onStage("PROCESSING", "RENDERING_CLIPS", 35 + Math.round(results.length / selected.length * 55));
    }
    await onStage("VALIDATING", "MEDIA_VALIDATION", 95);
    const posters = path.join(getStorageRoot(), "uploads", outputProjectId); await mkdir(posters, { recursive: true });
    if (original.source.mediaKind !== 'AUDIO') { try { await copyFile(resolveStoragePath(path.posix.join("uploads", original.id, "poster.jpg")), path.join(posters, "poster.jpg")); }
    catch { await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", resolveStoragePath(results[0].relativePath), "-frames:v", "1", path.join(posters, "poster.jpg")]); }
    }
    project.clipsOrigin.deliveryComplete = true;
    await updateProjectFile(outputProjectId, current => { current.clipsOrigin.deliveryComplete = true; });
    return { projectId: outputProjectId, clips: results, requestedCount: count, actualCount: results.length, warnings: selectionWarning ? [selectionWarning] : [], validation: { valid: results.every(r => r.validation?.valid), checkedAt: new Date().toISOString(), clipCount: results.length, distinct: true }, title: `Clips de ${original.source.originalName}` };
  }
}

function editingKey(clip) {
  return JSON.stringify({ edit: clip.edit, subtitles: clip.subtitles || null, autoReframe: clip.autoReframe || null });
}

/** Preserve the rescue branch's finite, non-overlapping candidate validation. */
export function selectIndependentClips(candidates, { count, minDuration, maxDuration, sourceEnd = Infinity, onlyChatReactions = false, ownershipStartUtc, ownershipEndUtc, sourceRanges = [], excludedReactionPeaks = [], continuityBreaks = [], continuityIntervals = [] }) {
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
    if (ownershipStartUtc) {
      const midpoint = (candidate.startTime + candidate.endTime) / 2;
      const range = [...sourceRanges].reverse().find(r=>Number.isFinite(r.offsetSeconds) && r.offsetSeconds<=midpoint && Number.isFinite(Date.parse(r.sourceStartUtc)));
      const hasReaction = (reaction?.isCollectiveReaction || reaction?.isPeak) && reaction.score >= 25;
      const anchor = hasReaction ? Date.parse(reaction.peakUtc) : range ? Date.parse(range.sourceStartUtc)+(midpoint-range.offsetSeconds)*1000 : NaN;
      if (!Number.isFinite(anchor) || anchor<Date.parse(ownershipStartUtc) || anchor>=Date.parse(ownershipEndUtc)) continue;
    }
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

