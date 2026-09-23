import { randomUUID } from "node:crypto";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { buildNewsBriefFromTranscript } from "./NewsSummaryService.mjs";
import { NewsRenderService } from "./NewsRenderService.mjs";

const renderService = new NewsRenderService();

export async function getNewsBrief(projectId) {
  const project = await loadProjectFile(projectId);
  if (!project) return null;
  return project.newsBrief || null;
}

export async function prepareNewsBrief(projectId, options = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const transcript = project.transcript;
  if (
    !transcript ||
    transcript.status !== "COMPLETED" ||
    !Array.isArray(transcript.segments) ||
    transcript.segments.length === 0
  ) {
    throw new Error("A completed transcript is required before News Mode.");
  }

  const existing = project.newsBrief;
  const requestedTemplate = options.template ? String(options.template).toUpperCase() : null;

  if (
    existing &&
    existing.sourceTranscriptId === transcript.id &&
    (!requestedTemplate || existing.template === requestedTemplate) &&
    ["READY", "RENDERING", "RENDERED"].includes(existing.status)
  ) {
    return { newsBrief: existing, reused: true };
  }

  const generated = buildNewsBriefFromTranscript(transcript, options);
  const now = new Date().toISOString();

  const newsBrief = {
    id: randomUUID(),
    projectId,
    sourceTranscriptId: String(transcript.id || ""),
    status: "READY",
    ...generated,
    createdAt: now,
    updatedAt: now,
    error: null,
    render: null,
  };

  project.newsBrief = newsBrief;
  await replaceProjectFile(projectId, project);

  return { newsBrief, reused: false };
}

export async function renderNewsBrief(
  projectId,
  onProgress = () => undefined,
) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const brief = project.newsBrief;
  if (!brief) throw new Error("News brief has not been prepared.");

  if (brief.status === "RENDERED" && brief.render?.relativePath) {
    return { newsBrief: brief, reused: true };
  }

  brief.status = "RENDERING";
  brief.updatedAt = new Date().toISOString();
  brief.error = null;
  await replaceProjectFile(projectId, project);

  try {
    const render = await renderService.render({
      project,
      brief,
      onProgress,
    });

    brief.render = render;
    brief.status = "RENDERED";
    brief.updatedAt = new Date().toISOString();
    brief.error = null;
    await replaceProjectFile(projectId, project);

    return { newsBrief: brief, reused: false };
  } catch (error) {
    brief.status = "FAILED";
    brief.updatedAt = new Date().toISOString();
    brief.error = error instanceof Error ? error.message : "News render failed.";
    await replaceProjectFile(projectId, project);
    throw error;
  }
}

export async function markNewsReadyForRetry(projectId) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");
  if (!project.newsBrief) throw new Error("News brief not found.");

  project.newsBrief.status = "READY";
  project.newsBrief.render = null;
  project.newsBrief.error = null;
  project.newsBrief.updatedAt = new Date().toISOString();
  await replaceProjectFile(projectId, project);

  return project.newsBrief;
}
