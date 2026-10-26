import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { ingestUrlJob } from "../services/ingest/UrlIngestService.mjs";
import { isRetryableIngestError } from "../lib/ingest-error-policy.mjs";
import { LiveSessionStore } from "../services/live/LiveSessionStore.mjs";
import { materializeLiveWindow, enqueueReadyLiveWindows } from "../services/live/LiveWindowService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  1000,
  Number(process.env.CLIPFORGE_INGEST_POLL_MS || process.env.CLIPFORGE_WORKER_POLL_MS || 2500),
);
const store = new IngestJobStore();
const sessions = new LiveSessionStore();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge ingest worker started.");

while (!stopping) {
  // Drain closed originals even after capture stops and when R2 is unavailable.
  // The coordinator only queues bounded local work; it never starts a monitor.
  for (const session of await sessions.list()) {
    try { await enqueueReadyLiveWindows(session.id, { sessions, jobs: store }); }
    catch (error) { console.error("Live queue coordination failed", { sessionId: session.id, code: error.code || "LIVE_QUEUE_FAILED" }); }
  }
  const job = await store.claimNext(["INGEST_URL", "INGEST_UPLOAD", "INGEST_LIVE_WINDOW"]);
  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  const controller = new AbortController();
  const cancellation = setInterval(async () => {
    try { if (stopping || (await store.get(job.id))?.status === "CANCELLED") controller.abort(); }
    catch { controller.abort(); }
  }, 1000);
  const heartbeat = setInterval(() => {
    void store.heartbeat(job.id).catch(() => undefined);
  }, 15_000);
  heartbeat.unref?.();

  try {
    const ingest = job.type === "INGEST_LIVE_WINDOW" ? materializeLiveWindow : ingestUrlJob;
    const result = await ingest(job, {
      signal: controller.signal,
      onProgress: async (progress, stage, details) => {
        await store.updateProgress(job.id, progress, stage, details);
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
    clearInterval(cancellation);
  }

  if (once) break;
}

console.log("ClipForge ingest worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
