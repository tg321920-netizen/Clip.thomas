import { randomUUID } from "node:crypto";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { RenderService } from "./RenderService.mjs";

const renderService = new RenderService();

export async function createClipFromCandidate(
  projectId,
  candidateId,
  options = {},
) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

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
    },
    subtitles: null,
    autoEdit: null,
    render: null,
    createdAt: now,
    updatedAt: now,
    error: null,
  };

  project.clips.push(clip);
  await replaceProjectFile(projectId, project);

  return { clip, reused: false };
}

export async function renderClip(projectId, clipId, onProgress = () => undefined) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clips = Array.isArray(project.clips) ? project.clips : [];
  const clip = clips.find((entry) => entry.id === clipId);
  if (!clip) throw new Error("Clip not found.");

  if (clip.status === "READY" && clip.render?.relativePath) {
    return { clip, reused: true };
  }

  clip.status = "RENDERING";
  clip.error = null;
  clip.updatedAt = new Date().toISOString();
  await replaceProjectFile(projectId, project);

  try {
    const render = await renderService.renderClip({
      project,
      clip,
      onProgress,
    });

    clip.render = render;
    clip.status = "READY";
    clip.updatedAt = new Date().toISOString();
    clip.error = null;

    await replaceProjectFile(projectId, project);

    return { clip, reused: false };
  } catch (error) {
    clip.status = "FAILED";
    clip.updatedAt = new Date().toISOString();
    clip.error = error instanceof Error ? error.message : "Render failed.";
    await replaceProjectFile(projectId, project);
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
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const clip = project.clips?.find((entry) => entry.id === clipId);
  if (!clip) throw new Error("Clip not found.");

  clip.status = "QUEUED";
  clip.updatedAt = new Date().toISOString();
  clip.error = null;

  await replaceProjectFile(projectId, project);
  return clip;
}

function normalizeFraming(value) {
  return value === "FIT" ? "FIT" : "FILL";
}

function normalizeQuality(value) {
  if (value === "FAST" || value === "HIGH") return value;
  return "BALANCED";
}
