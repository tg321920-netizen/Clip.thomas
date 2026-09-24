import { JobStore } from "../services/JobStore.mjs";
import { AnalyticsCollectorService } from "../services/analytics/AnalyticsCollectorService.mjs";
import { AnalyticsService } from "../services/analytics/AnalyticsService.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  60_000,
  Number(process.env.CLIPFORGE_ANALYTICS_POLL_MS || 15 * 60 * 1000),
);
const minAgeMs = Math.max(
  60_000,
  Number(process.env.CLIPFORGE_ANALYTICS_REFRESH_MS || 60 * 60 * 1000),
);

const jobs = new JobStore();
const publications = new PublicationService();
const analytics = new AnalyticsService({ publications });
const collector = new AnalyticsCollectorService({ publications, analytics });
let stopping = false;

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

console.log("ClipForge analytics worker started.");

while (!stopping) {
  try {
    const enqueued = await enqueueDueAnalytics();
    let processed = 0;
    for (let index = 0; index < 10; index += 1) {
      const didProcess = await processOneAnalyticsJob();
      if (!didProcess) break;
      processed += 1;
    }

    if (enqueued > 0 || processed > 0) {
      console.log("Analytics worker cycle completed", { enqueued, processed });
    }
  } catch (error) {
    console.error("Analytics collection cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (once) break;
  await sleep(pollMs);
}

console.log("ClipForge analytics worker stopped.");

async function enqueueDueAnalytics() {
  const published = await publications.list({ status: "PUBLISHED" });
  let enqueued = 0;

  for (const publication of published.slice(0, 100)) {
    if (!publication.externalPostId) continue;

    const latest = await analytics.latest(publication.id);
    if (isRecent(latest?.capturedAt, minAgeMs)) continue;

    const existing = await jobs.getAnalyticsJob(
      publication.projectId,
      publication.id,
    );
    if (["QUEUED", "PROCESSING"].includes(existing?.status)) continue;
    if (isRecent(existing?.completedAt, minAgeMs)) continue;

    await jobs.enqueueAnalytics(
      publication.projectId,
      publication.id,
      { publicationId: publication.id },
      { restartCompleted: existing?.status === "COMPLETED" },
    );
    enqueued += 1;
  }

  return enqueued;
}

async function processOneAnalyticsJob() {
  const job = await jobs.claimNext(["FETCH_ANALYTICS"]);
  if (!job) return false;

  const publicationId = job.entityId || job.payload?.publicationId;
  try {
    if (!publicationId) {
      throw new Error("Analytics job is missing publicationId.");
    }

    const result = await collector.collectPublication(publicationId);
    await jobs.complete({
      ...job,
      result: {
        publicationId,
        collected: result.collected,
        reason: result.reason,
        snapshotId: result.snapshot?.id || null,
      },
    });
  } catch (error) {
    await jobs.fail(job, error, {
      retryable: error?.retryable === true,
    });
    console.error("Analytics provider request failed", {
      publicationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return true;
}

function isRecent(value, maxAgeMs) {
  const timestamp = Date.parse(value || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp < maxAgeMs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
