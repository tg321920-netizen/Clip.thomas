import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { createRedisKvFromEnv } from "../../lib/redis-kv.mjs";
import { PublishingService } from "./PublishingService.mjs";
import { SmartLicensedClipService } from "./SmartLicensedClipService.mjs";

const JOB_DIR = "smart-publish";
const JOB_FILE = "current.json";
const PROCESSING_POLL_MS = 10_000;
const PROCESSING_MAX_POLLS = 36;
const JOB_KV_KEY = "clipforge:smart-publish:v1:current";
const kv = createRedisKvFromEnv();

export async function queueSmartPublishJob(channelId) {
  const now = new Date().toISOString();
  const job = {
    id: randomUUID(),
    channelId,
    status: "QUEUED",
    stage: "QUEUED",
    progress: 0,
    title: null,
    duration: null,
    publicationId: null,
    externalPostUrl: null,
    error: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    completedAt: null,
  };
  await saveJob(job);
  console.log("[smart-publish-job] queued", { id: job.id, channelId });
  return publicJob(job);
}

export async function recordSmartPublishFailure(error, stage = "FAILED") {
  const now = new Date().toISOString();
  const current = await readJob();
  const job = {
    ...(current || {
      id: randomUUID(),
      channelId: null,
      createdAt: now,
    }),
    status: "FAILED",
    stage,
    error: sanitizeError(error),
    updatedAt: now,
    completedAt: now,
  };
  await saveJob(job);
  return publicJob(job);
}

export async function getSmartPublishJobStatus() {
  const job = await readJob();
  if (!job) {
    return {
      status: "IDLE",
      stage: "IDLE",
      progress: 0,
      externalPostUrl: null,
      error: null,
    };
  }

  if (job.publicationId && ["YOUTUBE_PROCESSING", "PUBLISHING"].includes(job.status)) {
    try {
      const publishing = new PublishingService();
      const refreshed = await publishing.refreshPublicationStatus(job.publicationId);
      if (refreshed?.publication?.status === "PUBLISHED") {
        const completed = {
          ...job,
          status: "PUBLISHED",
          stage: "PUBLISHED",
          progress: 100,
          externalPostUrl:
            refreshed.publication.externalPostUrl || job.externalPostUrl || null,
          updatedAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
          error: null,
        };
        await saveJob(completed);
        return publicJob(completed);
      }
    } catch {
      // Status reads must remain safe and non-destructive while YouTube processes.
    }
  }

  return publicJob(job);
}

export async function runQueuedSmartPublishJob() {
  const job = await readJob();
  if (!job || !["QUEUED", "RUNNING"].includes(job.status)) {
    return { handled: false, job: job ? publicJob(job) : null };
  }

  const running = {
    ...job,
    status: "RUNNING",
    stage: job.stage === "QUEUED" ? "STARTING" : job.stage,
    startedAt: job.startedAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    error: null,
  };
  await saveJob(running);

  const service = new SmartLicensedClipService();
  const publishing = new PublishingService();

  try {
    const result = await service.run(running.channelId, {
      onStage: async (update) => {
        const current = (await readJob()) || running;
        await saveJob({
          ...current,
          status: update.stage === "PUBLISHED" ? "PUBLISHED" : "RUNNING",
          stage: update.stage,
          progress: normalizeProgress(update),
          title: update.title || current.title || null,
          duration: Number(update.duration || current.duration || 0) || null,
          publicationId: update.publicationId || current.publicationId || null,
          externalPostUrl: update.externalPostUrl || current.externalPostUrl || null,
          updatedAt: new Date().toISOString(),
          completedAt:
            update.stage === "PUBLISHED" ? new Date().toISOString() : current.completedAt || null,
        });
      },
    });

    let publication = result.publication;
    let current = (await readJob()) || running;
    current = {
      ...current,
      title: result.editorial?.title || current.title || null,
      duration: Number(result.candidate?.duration || current.duration || 0) || null,
      publicationId: publication?.id || current.publicationId || null,
      externalPostUrl: result.externalPostUrl || current.externalPostUrl || null,
      updatedAt: new Date().toISOString(),
    };
    await saveJob(current);

    if (publication?.status !== "PUBLISHED" && publication?.id) {
      await updateJobStage("YOUTUBE_PROCESSING", {
        status: "YOUTUBE_PROCESSING",
        progress: 98,
      });

      for (let attempt = 0; attempt < PROCESSING_MAX_POLLS; attempt += 1) {
        await sleep(PROCESSING_POLL_MS);
        try {
          const refreshed = await publishing.refreshPublicationStatus(publication.id);
          publication = refreshed.publication;
          if (publication.status === "PUBLISHED" || publication.status === "FAILED") break;
        } catch (error) {
          console.warn("[smart-publish-job] YouTube processing poll failed", {
            attempt: attempt + 1,
            error: sanitizeError(error),
          });
        }
      }
    }

    if (publication?.status !== "PUBLISHED") {
      throw new Error(
        publication?.status === "FAILED"
          ? publication.error || "YouTube rejected the publication."
          : "YouTube upload finished but processing did not reach PUBLISHED before the verification timeout.",
      );
    }

    const completed = {
      ...((await readJob()) || current),
      status: "PUBLISHED",
      stage: "PUBLISHED",
      progress: 100,
      publicationId: publication.id,
      externalPostUrl: publication.externalPostUrl || result.externalPostUrl || null,
      title: result.editorial?.title || current.title || null,
      duration: Number(result.candidate?.duration || current.duration || 0) || null,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    };
    await saveJob(completed);
    console.log("[smart-publish-job] published", {
      id: completed.id,
      title: completed.title,
      duration: completed.duration,
      externalPostUrl: completed.externalPostUrl,
    });
    return { handled: true, job: publicJob(completed) };
  } catch (error) {
    const failed = await recordSmartPublishFailure(error, "FAILED");
    console.error("[smart-publish-job] failed", {
      id: running.id,
      error: failed.error,
    });
    return { handled: true, job: failed };
  }
}

async function updateJobStage(stage, patch = {}) {
  const current = await readJob();
  if (!current) return null;
  const next = {
    ...current,
    ...patch,
    stage,
    updatedAt: new Date().toISOString(),
  };
  await saveJob(next);
  return next;
}

function normalizeProgress(update) {
  if (update.stage === "PUBLISHED") return 100;
  if (update.stage === "YOUTUBE_PROCESSING") return 98;
  if (update.stage === "UPLOADING_TO_YOUTUBE") return 92;
  if (update.stage === "CREATING_TITLE_AND_METADATA") return 88;
  if (update.stage === "RENDERING") {
    const renderProgress = Number(update.progress || 0);
    return Math.min(86, 55 + Math.round(renderProgress * 0.31));
  }
  const fixed = {
    QUEUED: 2,
    STARTING: 4,
    CHECKING_YOUTUBE_CONNECTION: 6,
    DISCOVERING_POPULAR_CC_VIDEOS: 12,
    SOURCE_SELECTED: 20,
    DOWNLOADING_SOURCE: 25,
    USING_VERIFIED_CC_FALLBACK: 28,
    TRANSCRIBING: 38,
    ANALYZING_HIGHLIGHTS: 50,
    GENERATING_SUBTITLES: 54,
    APPLYING_SMOOTH_ZOOM: 56,
  };
  return fixed[update.stage] ?? 10;
}

function publicJob(job) {
  return {
    id: job.id || null,
    status: job.status || "IDLE",
    stage: job.stage || job.status || "IDLE",
    progress: Number(job.progress || 0),
    title: job.title || null,
    duration: Number(job.duration || 0) || null,
    publicationId: job.publicationId || null,
    externalPostUrl: job.externalPostUrl || null,
    error: job.error || null,
    createdAt: job.createdAt || null,
    updatedAt: job.updatedAt || null,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
  };
}

async function readJob() {
  try {
    const raw = await readFile(jobPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    // Free Render web instances have ephemeral local storage. Fall through to
    // the shared Key Value store when configured.
  }

  if (!kv) return null;

  try {
    const raw = await kv.get(JOB_KV_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn("[smart-publish-job] shared state read failed", {
      error: sanitizeError(error),
    });
    return null;
  }
}

async function saveJob(job) {
  const serialized = JSON.stringify(job, null, 2);
  const directory = path.dirname(jobPath());
  await mkdir(directory, { recursive: true });
  await writeFile(jobPath(), serialized, "utf8");

  if (kv) {
    await kv.set(JOB_KV_KEY, JSON.stringify(job));
  }
}

function jobPath() {
  return path.join(getStorageRoot(), JOB_DIR, JOB_FILE);
}

function sanitizeError(error) {
  return String(error instanceof Error ? error.message : error || "Unknown error")
    .replace(/(access_token|refresh_token|client_secret|authorization)=?[^\s&]*/gi, "$1=[redacted]")
    .slice(0, 1000);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
