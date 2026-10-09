import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { ingestUrlJob } from "../services/ingest/UrlIngestService.mjs";
import { isRetryableIngestError } from "../lib/ingest-error-policy.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  1000,
  Number(process.env.CLIPFORGE_INGEST_POLL_MS || process.env.CLIPFORGE_WORKER_POLL_MS || 2500),
);
const store = new IngestJobStore();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge ingest worker started.");

while (!stopping) {
  const job = await store.claimNext();
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
    const result = await ingestUrlJob(job, {
      onProgress: async (progress, stage) => {
        await store.updateProgress(job.id, progress, stage);
        await store.heartbeat(job.id);
      },
    });

    await store.complete(job, result);
    console.log("URL ingest completed", {
      jobId: job.id,
      projectId: result.projectId,
      mode: job.source?.mode,
    });
  } catch (error) {
    const failed = await store.fail(job, error, { retryable: isRetryableIngestError(error) });
    console.error("URL ingest failed", {
      jobId: job.id,
      mode: job.source?.mode,
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

console.log("ClipForge ingest worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
