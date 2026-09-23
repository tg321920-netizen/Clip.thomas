import { JobStore } from "../services/JobStore.mjs";
import { renderNewsBrief } from "../services/news/NewsService.mjs";

const once = process.argv.includes("--once");
const pollMs = Number(process.env.CLIPFORGE_WORKER_POLL_MS || 2000);
const store = new JobStore();

let stopping = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

console.log("ClipForge News worker started.");

while (!stopping) {
  const job = await store.claimNext(["RENDER_NEWS"]);

  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  try {
    let lastProgress = Number(job.progress || 0);
    let progressWrites = Promise.resolve();

    const result = await renderNewsBrief(job.projectId, (progress) => {
      if (progress === 100 || progress - lastProgress >= 5) {
        lastProgress = progress;
        progressWrites = progressWrites.then(() =>
          store.updateProgress(job.id, progress),
        );
      }
    });

    await progressWrites;
    await store.complete({
      ...job,
      result: {
        newsBriefId: result.newsBrief.id,
        sourceUrl: result.newsBrief.render?.sourceUrl || null,
        reused: result.reused,
      },
    });

    console.log("News render completed", {
      projectId: job.projectId,
      newsBriefId: result.newsBrief.id,
      reused: result.reused,
    });
  } catch (error) {
    const failed = await store.fail(job, error);

    console.error("News render failed", {
      projectId: job.projectId,
      status: failed.status,
      attempts: failed.attempts,
      error: failed.error,
    });
  }

  if (once) break;
}

console.log("ClipForge News worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
