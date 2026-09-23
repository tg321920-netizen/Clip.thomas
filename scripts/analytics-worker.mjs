import { JobStore } from "../services/JobStore.mjs";
import { AnalyticsCollectorService } from "../services/analytics/AnalyticsCollectorService.mjs";
import { AnalyticsService } from "../services/analytics/AnalyticsService.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  30_000,
  Number(process.env.CLIPFORGE_ANALYTICS_POLL_MS || 300_000),
);
const refreshMs = Math.max(
  15 * 60 * 1000,
  Number(process.env.CLIPFORGE_ANALYTICS_REFRESH_MS || 6 * 60 * 60 * 1000),
);

const jobs = new JobStore();
const analytics = new AnalyticsService();
const publications = new PublicationService();
const collector = new AnalyticsCollectorService({ analytics, publications });

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge analytics worker started.");

while (!stopping) {
  try {
    await enqueueDueAnalytics();
    await processOneAnalyticsJob();
  } catch (error) {
    console.error("Analytics worker cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (once) break;
  await sleep(pollMs);
}

console.log("ClipForge analytics worker stopped.");

async function enqueueDueAnalytics() {
  const published = await publications.list({ status: "PUBLISHED" });
  const now = Date.now();

  for (const publication of published.slice(0, 200)) {
    if (!collector.supportsPlatform(publication.platform)) continue;

    const latest = await analytics.latest(publication.id);
    if (
      latest &&
      Number.isFinite(Date.parse(latest.capturedAt)) &&
      now - Date.parse(latest.capturedAt) < refreshMs
    ) {
      continue;
    }

    const existing = await jobs.getAnalyticsJob(
      publication.projectId,
      publication.id,
    );
    if (existing && ["QUEUED", "PROCESSING"].includes(existing.status)) continue;

    await jobs.enqueueAnalytics(
      publication.projectId,
      publication.id,
      { publicationId: publication.id },
      { restartCompleted: true },
    );
  }
}

async function processOneAnalyticsJob() {
  const job = await jobs.claimNext(["FETCH_ANALYTICS"]);
  if (!job) return;

  const publicationId = job.entityId || job.payload?.publicationId;
  try {
    if (!publicationId) throw new Error("Analytics job is missing publicationId.");
    const result = await collector.collect(publicationId);
    await jobs.complete({
      ...job,
      result: {
        publicationId,
        supported: result.supported,
        snapshotId: result.snapshot?.id || null,
        reason: result.reason || null,
      },
    });
  } catch (error) {
    await jobs.fail(job, error, {
      retryable: error?.retryable !== false,
    });
    console.error("Analytics job failed", {
      publicationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
