import { JobStore } from "../services/JobStore.mjs";
import { PublicationService } from "../services/publications/PublicationService.mjs";
import { PublishingReadinessService } from "../services/publishing/PublishingReadinessService.mjs";
import { PublishingService } from "../services/publishing/PublishingService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  5000,
  Number(process.env.CLIPFORGE_PUBLISHING_POLL_MS || 30000),
);

const jobs = new JobStore();
const publications = new PublicationService();
const publishing = new PublishingService({ publications });
const readiness = new PublishingReadinessService({ publications });

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge publishing worker started.");

while (!stopping) {
  try {
    await enqueueDuePublications();
    await refreshSubmittedPublications();
    await processOnePublishJob();
  } catch (error) {
    console.error("Publishing worker cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (once) break;
  await sleep(pollMs);
}

console.log("ClipForge publishing worker stopped.");

async function enqueueDuePublications() {
  const now = Date.now();
  const scheduled = await publications.list({ status: "SCHEDULED" });

  for (const publication of scheduled) {
    const scheduledAt = Date.parse(publication.scheduledAt || "");
    if (!Number.isFinite(scheduledAt) || scheduledAt > now) continue;

    const state = await readiness.check(publication.id);
    if (!state.ready) {
      console.log("Publication is due but not ready for provider submission", {
        publicationId: publication.id,
        platform: publication.platform,
        reasons: state.reasons,
      });
      continue;
    }

    await jobs.enqueuePublish(
      publication.projectId,
      publication.id,
      { publicationId: publication.id },
    );
  }
}

async function processOnePublishJob() {
  const job = await jobs.claimNext(["PUBLISH_POST"]);
  if (!job) return;

  const publicationId = job.entityId || job.payload?.publicationId;

  try {
    if (!publicationId) throw new Error("Publish job is missing publicationId.");

    const result = await publishing.publishPublication(publicationId);
    await jobs.complete({
      ...job,
      result: {
        publicationId,
        externalPostId: result.publication?.externalPostId || null,
        publicationStatus: result.publication?.status || null,
      },
    });

    console.log("Publication submitted to provider", {
      publicationId,
      platform: result.publication?.platform,
      status: result.publication?.status,
    });
  } catch (error) {
    await jobs.fail(job, error, { retryable: false });
    console.error("Publish job failed without automatic resubmission", {
      publicationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function refreshSubmittedPublications() {
  const pending = await publications.list({ status: "PUBLISHING" });

  for (const publication of pending.slice(0, 50)) {
    try {
      const state = await readiness.check(publication.id);
      if (!state.ready) continue;

      const result = await publishing.refreshPublicationStatus(publication.id);
      if (result.changed) {
        console.log("Publication provider status changed", {
          publicationId: publication.id,
          status: result.publication.status,
        });
      }
    } catch (error) {
      console.error("Provider status refresh failed", {
        publicationId: publication.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
