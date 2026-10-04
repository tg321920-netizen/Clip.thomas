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
const RESUMABLE_PUBLICATION_STAGES = new Set([
  "UPLOADING_TO_YOUTUBE",
  "YOUTUBE_PROCESSING",
  "PUBLISHING",
]);
const RUNNABLE_JOB_STATUSES = new Set([
  "QUEUED",
  "RUNNING",
  "YOUTUBE_PROCESSING",
  "PUBLISHING",
]);
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

  if (
    job.publicationId &&
    (
      ["YOUTUBE_PROCESSING", "PUBLISHING"].includes(job.status) ||
      ["UPLOADING_TO_YOUTUBE", "YOUTUBE_PROCESSING", "PUBLISHING"].includes(job.stage)
    )
  ) {
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
  if (!job || !RUNNABLE_JOB_STATUSES.has(job.status)) {
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
    const recoveredPublication = await recoverPersistedYouTubePublication(
      running,
      publishing,
    );
    if (recoveredPublication?.status === "PUBLISHED") {
      const completed = {
        ...running,
        status: "PUBLISHED",
        stage: "PUBLISHED",
        progress: 100,
        publicationId: recoveredPublication.id,
        externalPostUrl:
          recoveredPublication.externalPostUrl || running.externalPostUrl || null,
        updatedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        error: null,
      };
      await saveJob(completed);
      console.log("[smart-publish-job] recovered published job", {
        id: completed.id,
        publicationId: completed.publicationId,
        externalPostUrl: completed.externalPostUrl,
      });
      return { handled: true, job: publicJob(completed) };
    }

    if (recoveredPublication?.status === "PUBLISHING") {
      const processing = {
        ...running,
        status: "YOUTUBE_PROCESSING",
        stage: "YOUTUBE_PROCESSING",
        progress: 98,
        publicationId: recoveredPublication.id,
        externalPostUrl:
          recoveredPublication.externalPostUrl || running.externalPostUrl || null,
        updatedAt: new Date().toISOString(),
        completedAt: null,
        error: null,
      };
      await saveJob(processing);
      console.log("[smart-publish-job] recovered upload is still processing", {
        id: processing.id,
        publicationId: processing.publicationId,
        externalPostUrl: processing.externalPostUrl,
      });
      return { handled: true, job: publicJob(processing) };
    }

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

    if (publication?.status === "FAILED") {
      throw new Error(
        publication.error || "YouTube rejected the publication.",
      );
    }

    if (publication?.status !== "PUBLISHED") {
      const processing = {
        ...((await readJob()) || current),
        status: "YOUTUBE_PROCESSING",
        stage: "YOUTUBE_PROCESSING",
        progress: 98,
        publicationId: publication?.id || current.publicationId || null,
        externalPostUrl:
          publication?.externalPostUrl || result.externalPostUrl || current.externalPostUrl || null,
        title: result.editorial?.title || current.title || null,
        duration: Number(result.candidate?.duration || current.duration || 0) || null,
        updatedAt: new Date().toISOString(),
        error: null,
      };
      await saveJob(processing);
      console.log("[smart-publish-job] YouTube still processing; job remains resumable", {
        id: processing.id,
        publicationId: processing.publicationId,
        externalPostUrl: processing.externalPostUrl,
      });
      return { handled: true, job: publicJob(processing) };
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

export async function recoverPersistedYouTubePublication(
  job,
  publishing,
  options = {},
) {
  if (
    !job?.publicationId ||
    !RESUMABLE_PUBLICATION_STAGES.has(String(job.stage || ""))
  ) {
    return null;
  }

  const maxPolls = Math.max(
    1,
    Number(options.maxPolls || PROCESSING_MAX_POLLS),
  );
  const pollMs = Math.max(0, Number(options.pollMs ?? PROCESSING_POLL_MS));
  const sleepFn = options.sleepFn || sleep;

  let publication = await publishing.publications.get(job.publicationId);
  if (!publication) {
    throw new Error(
      "Persisted smart-publish publication is missing after restart; refusing to create a duplicate YouTube upload.",
    );
  }

  if (publication.status === "PUBLISHED") return publication;
  if (publication.status === "FAILED") {
    throw new Error(
      publication.error || "YouTube rejected the persisted publication.",
    );
  }

  if (publication.status === "SCHEDULED") {
    const submitted = await publishing.publishPublication(publication.id, {
      now: new Date(Date.now() + 2_000),
    });
    publication = submitted.publication;
  }

  if (
    publication.status === "PUBLISHING" &&
    !publication.externalPostId
  ) {
    throw new Error(
      "YouTube upload state is indeterminate after restart and has no external video id; refusing an unsafe duplicate upload.",
    );
  }

  if (publication.status === "PUBLISHED") return publication;
  if (publication.status !== "PUBLISHING") {
    throw new Error(
      `Cannot safely resume persisted YouTube publication from ${publication.status}.`,
    );
  }

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    if (pollMs > 0) await sleepFn(pollMs);

    try {
      const refreshed = await publishing.refreshPublicationStatus(publication.id);
      publication = refreshed.publication;
    } catch (error) {
      console.warn("[smart-publish-job] recovered YouTube processing poll failed", {
        attempt: attempt + 1,
        error: sanitizeError(error),
      });
      continue;
    }

    if (publication.status === "PUBLISHED") return publication;
    if (publication.status === "FAILED") {
      throw new Error(
        publication.error || "YouTube rejected the persisted publication.",
      );
    }
  }

  return publication;
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
  if (kv) {
    try {
      const raw = await kv.get(JOB_KV_KEY);
      if (raw) {
        const job = JSON.parse(raw);
        await writeLocalJob(job).catch(() => undefined);
        return job;
      }
    } catch (error) {
      const local = await readLocalJob();
      if (local) return local;
      console.warn("[smart-publish-job] shared state read failed", {
        error: sanitizeError(error),
      });
      return null;
    }
  }

  const local = await readLocalJob();
  if (!local) return null;

  if (kv) {
    await kv.set(JOB_KV_KEY, JSON.stringify(local)).catch(() => undefined);
  }
  return local;
}

async function saveJob(job) {
  if (kv) {
    await kv.set(JOB_KV_KEY, JSON.stringify(job));
    await writeLocalJob(job).catch(() => undefined);
    return;
  }

  await writeLocalJob(job);
}

async function readLocalJob() {
  try {
    const raw = await readFile(jobPath(), "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function writeLocalJob(job) {
  const serialized = JSON.stringify(job, null, 2);
  const directory = path.dirname(jobPath());
  await mkdir(directory, { recursive: true });
  await writeFile(jobPath(), serialized, "utf8");
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
