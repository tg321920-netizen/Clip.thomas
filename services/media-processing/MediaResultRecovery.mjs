import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { validateMp4 } from "./MediaValidationService.mjs";
import { clipResult } from '../clip/ClipResult.mjs';

/** Revalidate a completed checkpoint without losing the client's clip metadata. */
export async function recoverMediaResult(project, job, { validate = validateMp4 } = {}) {
  if (!project?.clips?.length || project.clips.some(clip => clip.status !== "READY" || !clip.render?.relativePath)) return null;
  if (job.type === "MEDIA_CLIPS" && project.clips.length !== Number(job.payload?.count ?? 3)) {
    // A render interruption must remain resumable. A deliberately smaller
    // editorial delivery is complete only after every selected clip was saved.
    const origin = project.clipsOrigin;
    if (origin?.deliveryComplete !== true || origin.requestedCount !== Number(job.payload?.count ?? 3)
      || origin.selectedCount !== project.clips.length || origin.selectedCount >= origin.requestedCount
      || project.analysis?.candidates?.length !== project.clips.length
      || !project.clips.every(clip => project.analysis.candidates.some(candidate => candidate.id === clip.candidateId))) return null;
  }

  const clips = [];
  for (const clip of project.clips) {
    const validation = await validate(resolveStoragePath(clip.render.relativePath), {
      requireAudio: project.source.hasAudio !== false,
      requireAudibleNarration: job.type === "MEDIA_STORY",
      duration: clip.duration,
      width: clip.render.width,
      height: clip.render.height,
      subtitleValidation: clip.render.validation?.subtitleValidation,
      allowDarkVideo: project.allowDarkVideo,
      audioOnly: job.type !== 'MEDIA_STORY' && project.source.mediaKind === 'AUDIO',
    });
    if (validation?.valid !== true) throw new Error("El archivo recuperado no pasó la validación técnica.");
    clips.push(clipResult(project, clip, validation));
  }

  if (job.type === "MEDIA_CLIPS") return {
    projectId: job.projectId,
    title: `Clips de ${project.source.originalName}`,
    clips,
    requestedCount: Number(job.payload?.count ?? 3),
    actualCount: clips.length,
    warnings: project.clipsOrigin?.selectionWarning ? [project.clipsOrigin.selectionWarning] : [],
    validation: { valid: true, checkedAt: new Date().toISOString(), clipCount: clips.length },
  };
  if (job.type === "MEDIA_STORY" && project.story) return { ...clips[0], projectId: job.projectId, title: project.story.title || project.source.originalName,
    recovery: project.story.recovery, story: { voice: project.story.voice, alignment: project.story.narrationAlignment, scenes: (project.story.scenes || []).map(scene => ({ order: scene.order, narration: scene.narration, startTime: scene.startTime, duration: scene.duration, imageUrl: scene.imageUrl, credit: scene.visualCredit, selection: scene.visualSelection })) },
    warnings: ["Revisión editorial pendiente: escucha la voz y comprueba texto, escenas y final antes de publicar."] };
  return { ...clips[0], projectId: job.projectId, title: project.source.originalName, cuts: project.autoEditEvidence };
}
