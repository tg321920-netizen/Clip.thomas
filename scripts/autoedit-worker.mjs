import { JobStore } from "../services/JobStore.mjs";
import { prepareAutoEdit } from "../services/autoedit/AutoEditService.mjs";
import { markClipQueued } from "../services/clip/ClipService.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";

const once = process.argv.includes("--once");
const pollMs = Number(process.env.CLIPFORGE_WORKER_POLL_MS || 2000);
const store = new JobStore();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge Auto Edit worker started.");

while (!stopping) {
  const job = await store.claimNext(["AUTO_EDIT"]);

  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  const heartbeat = setInterval(() => {
    void store.heartbeat(job.id).catch(() => undefined);
  }, 15_000);
  heartbeat.unref?.();

  try {
    const project = await loadProjectFile(job.projectId);
    if (!project) throw new Error("Project not found.");

    const payload = job.payload || {};
    const candidateIds = selectCandidateIds(project, payload);
    if (candidateIds.length === 0) {
      throw new Error("No eligible candidates were found for Auto Edit.");
    }

    const results = [];
    const errors = [];

    for (let index = 0; index < candidateIds.length; index += 1) {
      const candidateId = candidateIds[index];
      try {
        const result = await prepareAutoEdit(job.projectId, {
          ...payload,
          candidateId,
        });

        let renderJob = null;
        if (result.clip.status === "READY" && result.clip.render?.relativePath) {
          renderJob = await store.getRenderJob(job.projectId, result.clip.id);
        } else {
          await markClipQueued(job.projectId, result.clip.id);
          renderJob = await store.enqueueRender(
            job.projectId,
            result.clip.id,
            { clipId: result.clip.id },
            { restartCompleted: true },
          );
        }

        results.push({
          clipId: result.clip.id,
          candidateId: result.plan?.candidateId || result.clip.candidateId,
          reused: result.reused,
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
      await store.updateProgress(job.id, progress);
      await store.heartbeat(job.id);
    }

    if (results.length === 0) {
      throw new Error(
        `All Auto Edit candidates failed: ${errors.map((item) => item.error).join(" | ")}`,
      );
    }

    await store.complete({
      ...job,
      result: {
        clipIds: results.map((item) => item.clipId),
        candidateIds: results.map((item) => item.candidateId),
        clips: results,
        partialFailures: errors,
      },
    });

    console.log("Auto Edit batch completed", {
      projectId: job.projectId,
      clips: results.length,
      failedCandidates: errors.length,
    });
  } catch (error) {
    const failed = await store.fail(job, error);
    console.error("Auto Edit job failed", {
      projectId: job.projectId,
      status: failed.status,
      attempts: failed.attempts,
      error: failed.error,
      nextAttemptAt: failed.nextAttemptAt,
    });
  } finally {
    clearInterval(heartbeat);
  }

  if (once) break;
}

console.log("ClipForge Auto Edit worker stopped.");

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
