import { randomUUID } from "node:crypto";
import {
  loadProjectFile,
  replaceProjectFile,
} from "../../lib/project-files.mjs";
import {
  TranscriptCandidateProvider,
  normalizeAnalysisOptions,
} from "./TranscriptCandidateProvider.mjs";

export async function analyzeProject(projectId, options = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Project not found.");

  const transcript = project.transcript;
  if (
    !transcript ||
    transcript.status !== "COMPLETED" ||
    !Array.isArray(transcript.segments) ||
    transcript.segments.length === 0
  ) {
    throw new Error(
      "A completed transcript is required before content analysis.",
    );
  }

  const sourceKey = getAnalysisSourceKey(project);

  if (isAnalysisCurrent(project, sourceKey)) {
    return { analysis: project.analysis, reused: true };
  }

  const config = normalizeAnalysisOptions(options);
  const provider = options.provider || new TranscriptCandidateProvider(config);
  const startedAt = new Date().toISOString();

  project.analysis = {
    id: project?.analysis?.id || randomUUID(),
    projectId,
    status: "PROCESSING",
    provider: provider.name || "unknown",
    sourceKey,
    config,
    candidates: [],
    createdAt: project?.analysis?.createdAt || startedAt,
    startedAt,
    completedAt: null,
    error: null,
  };

  await replaceProjectFile(projectId, project);

  try {
    const candidates = await provider.analyze({
      project,
      transcript,
      options: config,
    });

    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Content analysis produced no valid candidates.");
    }

    project.analysis = {
      ...project.analysis,
      status: "COMPLETED",
      provider: provider.name || project.analysis.provider,
      candidates,
      completedAt: new Date().toISOString(),
      error: null,
    };

    await replaceProjectFile(projectId, project);

    return { analysis: project.analysis, reused: false };
  } catch (error) {
    project.analysis = {
      ...project.analysis,
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Content analysis failed.",
    };

    await replaceProjectFile(projectId, project);
    throw error;
  }
}

export function isAnalysisCurrent(
  project,
  sourceKey = getAnalysisSourceKey(project),
) {
  const analysis = project?.analysis;

  return Boolean(
    analysis &&
      analysis.status === "COMPLETED" &&
      analysis.sourceKey === sourceKey &&
      Array.isArray(analysis.candidates) &&
      analysis.candidates.length > 0,
  );
}

export function getAnalysisSourceKey(project) {
  const transcript = project?.transcript;
  if (!transcript) return "";

  return [
    transcript.id || "",
    transcript.completedAt || "",
    transcript.model || "",
    Array.isArray(transcript.segments) ? transcript.segments.length : 0,
  ].join(":");
}
