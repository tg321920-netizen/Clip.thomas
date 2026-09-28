import { JobStore } from "../services/JobStore.mjs";
import { prepareAutoEdit } from "../services/autoedit/AutoEditService.mjs";
import { runAutoEditBatch } from "../services/autoedit/AutoEditBatchService.mjs";
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

    const batch = await runAutoEditBatch({
      projectId: job.projectId,
      project,
      payload: job.payload || {},
      prepareAutoEdit,
      store,
      markClipQueued,
      onProgress: async (progress) => {
        await store.updateProgress(job.id, progress);
        await store.heartbeat(job.id);
      },
    });

    await store.complete({
      ...job,
      result: batch,
    });

    console.log("Auto Edit batch completed", {
      projectId: job.projectId,
      clips: batch.clips.length,
      failedCandidates: batch.partialFailures.length,
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
