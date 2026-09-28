export async function runAutoEditBatch({
  projectId,
  project,
  payload = {},
  prepareAutoEdit,
  store,
  markClipQueued,
  onProgress = async () => {},
}) {
  if (!projectId) throw new Error("Auto Edit batch requires projectId.");
  if (!project) throw new Error("Project not found.");
  if (typeof prepareAutoEdit !== "function") {
    throw new Error("Auto Edit batch requires a prepareAutoEdit function.");
  }
  if (!store) throw new Error("Auto Edit batch requires a job store.");

  const candidateIds = selectCandidateIds(project, payload);
  if (candidateIds.length === 0) {
    throw new Error("No eligible candidates were found for Auto Edit.");
  }

  const results = [];
  const errors = [];

  for (let index = 0; index < candidateIds.length; index += 1) {
    const candidateId = candidateIds[index];

    try {
      const result = await prepareAutoEdit(projectId, {
        ...payload,
        candidateId,
      });

      let renderJob = null;
      if (result.clip.status === "READY" && result.clip.render?.relativePath) {
        renderJob = await store.getRenderJob(projectId, result.clip.id);
      } else {
        if (typeof markClipQueued === "function") {
          await markClipQueued(projectId, result.clip.id);
        }
        renderJob = await store.enqueueRender(
          projectId,
          result.clip.id,
          { clipId: result.clip.id },
          { restartCompleted: true },
        );
      }

      results.push({
        clipId: result.clip.id,
        candidateId: result.plan?.candidateId || result.clip.candidateId || candidateId,
        reused: Boolean(result.reused),
        renderJobId: renderJob?.id || null,
      });
    } catch (error) {
      errors.push({
        candidateId,
        stage: "AUTO_EDIT",
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const progress = Math.min(
      95,
      Math.round(((index + 1) / candidateIds.length) * 90),
    );
    await onProgress(progress, { candidateId, index, total: candidateIds.length });
  }

  if (results.length === 0) {
    throw new Error(
      `All Auto Edit candidates failed: ${errors.map((item) => item.error).join(" | ")}`,
    );
  }

  return {
    clipIds: results.map((item) => item.clipId),
    candidateIds: results.map((item) => item.candidateId),
    clips: results,
    partialFailures: errors,
  };
}

export function selectCandidateIds(project, options = {}) {
  const candidates = Array.isArray(project?.analysis?.candidates)
    ? project.analysis.candidates
    : [];
  const requested = Array.isArray(options.candidateIds)
    ? options.candidateIds.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  if (requested.length > 0) {
    const valid = new Set(candidates.map((candidate) => candidate.id));
    return [...new Set(requested)].filter((id) => valid.has(id));
  }

  if (options.candidateId) {
    const id = String(options.candidateId);
    return candidates.some((candidate) => candidate.id === id) ? [id] : [];
  }

  const clipCount = boundedInteger(options.clipCount, 1, 20, 3);
  const minScore = boundedInteger(options.minScore, 0, 100, 0);

  return [...candidates]
    .filter((candidate) => Number(candidate.viralScore || 0) >= minScore)
    .sort(
      (a, b) =>
        Number(b.viralScore || 0) - Number(a.viralScore || 0) ||
        Number(a.startTime || 0) - Number(b.startTime || 0),
    )
    .slice(0, clipCount)
    .map((candidate) => candidate.id);
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(min, Math.min(max, number)));
}
