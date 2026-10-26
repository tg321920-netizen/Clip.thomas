import { randomUUID } from "node:crypto";
import {
  loadProjectFile,
  updateProjectFile,
} from "../../lib/project-files.mjs";
import { normalizeAnalysisOptions,TRANSCRIPT_HEURISTIC_VERSION } from "./TranscriptCandidateProvider.mjs";
import { createContentAnalysisProvider } from "./createContentAnalysisProvider.mjs";
import { releasePolicy } from "../../lib/release-policy.mjs";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { measureAudioEnergy, measureSceneChanges, sentenceSegments } from "./AudioEnergyService.mjs";

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
  const config = normalizeAnalysisOptions(options);

  const provider =
    options.provider ||
    createContentAnalysisProvider({
      ...config,
      providerName: releasePolicy().experimental ? options.providerName : 'heuristic',
      model: options.model,
    });
  if (isAnalysisCurrent(project, sourceKey, config) && project.analysis.provider === provider.name &&
      (project.analysis.model || null) === (provider.model || null) && Boolean(project.analysis.visionEnabled) === Boolean(provider.visionEnabled)) {
    return { analysis: project.analysis, reused: true };
  }
  const startedAt = new Date().toISOString();

  project.analysis = {
    id: project?.analysis?.id || randomUUID(),
    projectId,
    status: "PROCESSING",
    provider: provider.name || "unknown",
    model: provider.model || null,
    visionEnabled: provider.visionEnabled === true,
    sourceKey,
    config,
    candidates: [],
    createdAt: project?.analysis?.createdAt || startedAt,
    startedAt,
    completedAt: null,
    error: null,
  };

  await updateProjectFile(projectId, current => { current.analysis = project.analysis; });

  try {
    const [audioEnergyWindows, sceneChanges] = config.measureMediaEvidence
      ? await Promise.all([measureAudioEnergy(resolveStoragePath(project.source.relativePath)),measureSceneChanges(resolveStoragePath(project.source.relativePath))]) : [[],null];
    const candidates = await provider.analyze({
      project,
      transcript: config.requireCompleteSentences ? {...transcript,segments:sentenceSegments(transcript.segments,{maxGapSeconds:config.maxSilenceGapSeconds})} : transcript,
      options: config,
      audioEnergyWindows, sceneChanges, chatActivityWindows:project.liveObservation?.chatActivityWindows || [],
    });

    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("No se encontraron momentos completos dentro de la duración elegida. Ajusta el intervalo o usa el recorte manual.");
    }

    project.analysis = {
      ...project.analysis,
      status: "COMPLETED",
      provider: provider.name || project.analysis.provider,
      candidates,
      completedAt: new Date().toISOString(),
      error: null,
    };

    await updateProjectFile(projectId, current => { current.analysis = project.analysis; });

    return { analysis: project.analysis, reused: false };
  } catch (error) {
    project.analysis = {
      ...project.analysis,
      status: "FAILED",
      completedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Content analysis failed.",
    };

    await updateProjectFile(projectId, current => { current.analysis = project.analysis; });
    throw error;
  }
}

/**
 * @param {any} project
 * @param {string} [sourceKey]
 * @param {{ minDuration?: number, maxDuration?: number, targetDuration?: number, maxCandidates?: number } | null} [expectedConfig]
 */
export function isAnalysisCurrent(
  project,
  sourceKey = getAnalysisSourceKey(project),
  expectedConfig = null,
) {
  const analysis = project?.analysis;

  return Boolean(
    analysis &&
      (!/^transcript-heuristic-v\d+$/.test(analysis.provider)||analysis.provider===TRANSCRIPT_HEURISTIC_VERSION) &&
      analysis.status === "COMPLETED" &&
      analysis.sourceKey === sourceKey &&
      Array.isArray(analysis.candidates) &&
      analysis.candidates.length > 0 &&
      (!expectedConfig || analysisConfigsEqual(analysis.config, expectedConfig)),
  );
}

function analysisConfigsEqual(existing, expected) {
  if (!existing || !expected) return false;
  return JSON.stringify(normalizeAnalysisOptions(existing)) === JSON.stringify(normalizeAnalysisOptions(expected));
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
