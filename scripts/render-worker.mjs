import { JobStore } from "../services/JobStore.mjs";
import {
  getClip,
  renderClip,
} from "../services/clip/ClipService.mjs";

const once = process.argv.includes("--once");
const pollMs = Number(process.env.CLIPFORGE_WORKER_POLL_MS || 2000);
const store = new JobStore();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge render worker started.");

while (!stopping) {
  const job = await store.claimNext(["RENDER_CLIP"]);

  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  const clipId = job.entityId || job.payload?.clipId;

  try {
    if (!clipId) throw new Error("Render job is missing clipId.");

    const clip = await getClip(job.projectId, clipId);
    if (!clip) throw new Error("Clip not found.");

    let lastPersistedProgress = Number(job.progress || 0);

    const result = await renderClip(
      job.projectId,
      clipId,
      (progress) => {
        if (
          progress === 100 ||
          progress - lastPersistedProgress >= 5
        ) {
          lastPersistedProgress = progress;
          void store.updateProgress(job.id, progress);
        }
      },
    );

    await store.complete({
      ...job,
      result: {
        clipId,
        sourceUrl: result.clip?.render?.sourceUrl || null,
      },
    });

    console.log("Clip render completed", {
      projectId: job.projectId,
      clipId,
      reused: result.reused,
    });
  } catch (error) {
    const failed = await store.fail(job, error);

    console.error("Clip render failed", {
      projectId: job.projectId,
      clipId,
      status: failed.status,
      attempts: failed.attempts,
      error: failed.error,
    });
  }

  if (once) break;
}

console.log("ClipForge render worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
