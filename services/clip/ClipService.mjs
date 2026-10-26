import { validateMp4 } from "../media-processing/MediaValidationService.mjs";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { randomUUID, createHash } from "node:crypto";
import { loadProjectFile, updateProjectFile } from "../../lib/project-files.mjs";
import { RenderService } from "./RenderService.mjs";
import {manualOutputOptions} from '../../lib/render-options.mjs';
import { SUBTITLE_MODES, prepareSubtitleTrack } from '../subtitles/SubtitleService.mjs';
import { transcribeProject } from '../transcription/TranscriptionService.mjs';
import { LocalTranslationProvider } from '../subtitles/LocalTranslationProvider.mjs';

const defaultWidth=Number(process.env.CLIPFORGE_MEDIA_WIDTH||1080),defaultHeight=Number(process.env.CLIPFORGE_MEDIA_HEIGHT||1920);

/** Manual cuts reuse the render queue and require neither ASR nor a model. */
export async function createManualClip(projectId, input = {}) {
  return updateProjectFile(projectId, async project => {
    if (input.rightsConfirmed !== true) throw new Error('Confirma que tienes autorización para recortar este video.');
    const { startTime, endTime } = input;
    const sourceEnd = Math.min(project.source.durationSeconds, project.source.audioDurationSeconds || Infinity, project.source.videoDurationSeconds || Infinity);
    if (!Number.isFinite(sourceEnd) || typeof startTime !== 'number' || typeof endTime !== 'number' || !Number.isFinite(startTime) || !Number.isFinite(endTime) ||
      startTime < 0 || endTime <= startTime || endTime > sourceEnd + 0.001 || endTime - startTime < 0.5 || endTime - startTime > 180) {
      throw new Error('Elige un intervalo válido de 0,5 a 180 segundos dentro del original.');
    }
    if (project.source.captureValidation?.valid === false) throw new Error('La fuente necesita recuperación antes de renderizar.');
    if ((project.source.capture?.continuityIntervals || []).some(g => startTime < g.end && endTime > g.start) ||
      (project.source.capture?.continuityBreaks || []).some(t => startTime < t && endTime > t)) throw new Error('El intervalo atraviesa una interrupción de la fuente.');
    const framingMode = normalizeFraming(input.framingMode), quality = normalizeQuality(input.quality);
    const output=manualOutputOptions(input);
    const subtitleMode = input.subtitleMode || 'NONE';
    if (!SUBTITLE_MODES.includes(subtitleMode)) throw new Error('Modo de subtítulos inválido.');
    const candidateId = 'manual-' + createHash('sha256').update(JSON.stringify({ startTime, endTime, framingMode, quality,output, subtitleMode })).digest('hex').slice(0, 24);
    project.clips ||= [];
    const existing = project.clips.find(c => c.candidateId===candidateId || (c.candidateId.startsWith('manual-')&&
      c.startTime===startTime&&c.endTime===endTime&&(c.edit?.subtitleMode||'NONE')===subtitleMode&&c.edit?.framingMode===framingMode&&c.edit?.quality===quality&&
      (c.edit.output?.width??c.render?.width??defaultWidth)===output.width&&(c.edit.output?.height??c.render?.height??defaultHeight)===output.height));
    if (existing) return { clip: existing, reused: true };
    const now = new Date().toISOString(), clip = { id: randomUUID(), projectId, candidateId, startTime, endTime, duration: endTime - startTime,
      title: String(input.title || 'Recorte manual').slice(0, 140), reason: 'Intervalo elegido manualmente sobre el video original.', status: 'DRAFT',
      edit: { framingMode, quality,output, subtitleMode, subtitlesEnabled: subtitleMode !== 'NONE', subtitleStyle: 'CLEAN', autoReframeEnabled: false },
      editorialReview: { status: 'PENDING', analysisKind: 'MANUAL_SELECTION' }, subtitles: null, autoEdit: null, autoReframe: null, render: null,
      createdAt: now, updatedAt: now, error: null };
    project.clips.push(clip);
    return { clip, reused: false };
  });
}

export async function createClipFromCandidate(
  projectId,
  candidateId,
  options = {},
) {
  return updateProjectFile(projectId, async project => {
  const candidates = project?.analysis?.candidates;
  if (!Array.isArray(candidates)) {
    throw new Error("Project has no analyzed candidates.");
  }

  const candidate = candidates.find((entry) => entry.id === candidateId);
  if (!candidate) throw new Error("Candidate not found.");

  project.clips = Array.isArray(project.clips) ? project.clips : [];

  const existing = project.clips.find(
    (clip) =>
      clip.candidateId === candidateId &&
      clip.edit?.framingMode === normalizeFraming(options.framingMode) &&
      clip.edit?.quality === normalizeQuality(options.quality),
  );

  if (existing) {
    return { clip: existing, reused: true };
  }

  const now = new Date().toISOString();
  const clip = {
    id: randomUUID(),
    projectId,
    candidateId,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
    duration: candidate.duration,
    status: "DRAFT",
    edit: {
      framingMode: normalizeFraming(options.framingMode),
      subtitlesEnabled: false,
      subtitleStyle: "CLEAN",
      quality: normalizeQuality(options.quality),
      autoReframeEnabled: false,
    },
    subtitles: null,
    autoEdit: null,
    autoReframe: null,
    render: null,
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  project.clips.push(clip);
  return { clip, reused: false };
  });
}

export async function renderClip(projectId, clipId, onProgress = () => undefined) {
  let project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clips = Array.isArray(project.clips) ? project.clips : [];
  const clip = clips.find((entry) => entry.id === clipId);
  if (!clip) throw new Error("Clip not found.");
  const width=clip.edit?.output?.width||defaultWidth,height=clip.edit?.output?.height||defaultHeight;
  const renderService=new RenderService({width,height});

  if (clip.status === "READY" && clip.render?.relativePath) {
    try {
      clip.render.validation = await validateMp4(resolveStoragePath(clip.render.relativePath), { requireAudio: project.source.hasAudio !== false, duration: clip.duration,width,height, allowDarkVideo: project.allowDarkVideo });
      await saveClipState(projectId, clip);
      return { clip, reused: true };
    } catch { clip.render = null; }
  }

  clip.status = "RENDERING";
  clip.error = null;
  clip.updatedAt = new Date().toISOString();
  await saveClipState(projectId, clip);

  try {
    if (clip.edit?.subtitleMode && clip.edit.subtitleMode !== 'NONE') {
      if (clip.edit.subtitleMode === 'TRANSLATE_ES') new LocalTranslationProvider().assertConfigured();
      if (project.transcript?.status !== 'COMPLETED') {
        await transcribeProject(projectId);
        project = await loadProjectFile(projectId);
      }
      const track = await prepareSubtitleTrack(project, clip);
      await updateProjectFile(projectId, current => {
        const target = current.clips?.find(c => c.id === clipId);
        if (!target || Number(target.editRevision || 0) !== Number(clip.editRevision || 0)) throw new Error('El recorte cambió mientras se preparaban subtítulos.');
        target.subtitles = track;
      });
      clip.subtitles = track;
    }
    const render = await renderService.renderClip({
      project,
      clip,
      onProgress,
    });

    clip.render = render;
    clip.status = "READY";
    clip.updatedAt = new Date().toISOString();
    clip.error = null;

    await saveClipState(projectId, clip);

    return { clip, reused: render.recoveredWithoutEncoding===true };
  } catch (error) {
    clip.status = "FAILED";
    clip.updatedAt = new Date().toISOString();
    clip.error = error instanceof Error ? error.message : "Render failed.";
    await saveClipState(projectId, clip);
    throw error;
  }
}

export async function getClip(projectId, clipId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;

  const clips = Array.isArray(project.clips) ? project.clips : [];
  return clips.find((entry) => entry.id === clipId) || null;
}

export async function listClips(projectId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;
  return Array.isArray(project.clips) ? project.clips : [];
}

export async function markClipQueued(projectId, clipId) {
  return updateProjectFile(projectId, async project => {
  const clip = project.clips?.find((entry) => entry.id === clipId);
  if (!clip) throw new Error("Clip not found.");

  clip.status = "QUEUED";
  clip.updatedAt = new Date().toISOString();
  clip.error = null;

  return clip;
  });
}

async function saveClipState(projectId, clip) {
  return updateProjectFile(projectId, project => {
    const current = project.clips?.find(c => c.id === clip.id);
    if (!current) throw new Error('Clip not found.');
    if (Number(current.editRevision || 0) !== Number(clip.editRevision || 0)) {
      throw Object.assign(new Error('El recorte cambió durante el procesamiento. Sus cambios se conservaron; vuelve a renderizar.'), { code: 'CLIP_EDIT_CONFLICT' });
    }
    // A render owns these fields, not newer captions, review notes or settings.
    for (const key of ['status', 'render', 'error', 'updatedAt']) current[key] = clip[key];
  });
}

function normalizeFraming(value) {
  if (value === "FIT" || value === "CONVERSATION") return value;
  return "FILL";
}

function normalizeQuality(value) {
  if (value === "FAST" || value === "HIGH" || value === "EFFICIENT") return value;
  return "BALANCED";
}

