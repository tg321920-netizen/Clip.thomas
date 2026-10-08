import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { validateMp4 } from "./MediaValidationService.mjs";

/** Revalidate a completed checkpoint without losing the client's clip metadata. */
export async function recoverMediaResult(project, job, { validate = validateMp4 } = {}) {
  if (!project?.clips?.length || project.clips.some(clip => clip.status !== "READY" || !clip.render?.relativePath)) return null;
  if (job.type === "MEDIA_CLIPS" && project.clips.length !== Number(job.payload?.count ?? 3)) {
    throw new Error("El proyecto recuperado no contiene la cantidad de clips solicitada. Revisa el diagnóstico antes de reintentar.");
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
    });
    if (validation?.valid !== true) throw new Error("El archivo recuperado no pasó la validación técnica.");
    clips.push({
      clipId: clip.id,
      title: clip.title || project.source.originalName,
      duration: clip.duration,
      startTime: clip.startTime,
      endTime: clip.endTime,
      reason: clip.reason,
      editorialReview: clip.editorialReview || { status: "PENDING" },
      sourceUrl: clip.render.sourceUrl,
      downloadUrl: `${clip.render.sourceUrl}?download=1`,
      relativePath: clip.render.relativePath,
      validation,
    });
  }

  if (job.type === "MEDIA_CLIPS") return {
    projectId: job.projectId,
    title: `Clips de ${project.source.originalName}`,
    clips,
    validation: { valid: true, checkedAt: new Date().toISOString(), clipCount: clips.length },
  };
  return { ...clips[0], projectId: job.projectId, title: project.source.originalName, cuts: project.autoEditEvidence };
}
