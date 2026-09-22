import { JobStore } from "../services/JobStore.mjs";
import { prepareAutoEdit } from "../services/autoedit/AutoEditService.mjs";
import { markClipQueued } from "../services/clip/ClipService.mjs";

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

  try {
    await store.updateProgress(job.id, 10);

    const result = await prepareAutoEdit(job.projectId, job.payload || {});
    await store.updateProgress(job.id, 75);

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

    await store.complete({
      ...job,
      result: {
        clipId: result.clip.id,
        candidateId: result.plan?.candidateId || result.clip.candidateId,
        reused: result.reused,
        renderJobId: renderJob?.id || null,
      },
    });

    console.log("Auto Edit completed", {
      projectId: job.projectId,
      clipId: result.clip.id,
      reused: result.reused,
      renderQueued: Boolean(renderJob && renderJob.status !== "COMPLETED"),
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
  }

  if (once) break;
}

console.log("ClipForge Auto Edit worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
