import { JobStore } from "../services/JobStore.mjs";
import { analyzeProject } from "../services/analysis/ContentAnalysisService.mjs";

const once = process.argv.includes("--once");
const pollMs = Number(process.env.CLIPFORGE_WORKER_POLL_MS || 2000);
const store = new JobStore();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge analysis worker started.");

while (!stopping) {
  const job = await store.claimNext(["ANALYZE_VIDEO"]);

  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  console.log("Processing analysis job", {
    id: job.id,
    projectId: job.projectId,
    attempt: job.attempts,
  });

  try {
    const result = await analyzeProject(job.projectId, job.payload || {});
    await store.complete(job);

    console.log("Content analysis completed", {
      projectId: job.projectId,
      reused: result.reused,
      candidates: result.analysis?.candidates?.length ?? 0,
    });
  } catch (error) {
    const failed = await store.fail(job, error);
    console.error("Content analysis job failed", {
      projectId: job.projectId,
      status: failed.status,
      attempts: failed.attempts,
      error: failed.error,
      nextAttemptAt: failed.nextAttemptAt,
    });
  }

  if (once) break;
}

console.log("ClipForge analysis worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
