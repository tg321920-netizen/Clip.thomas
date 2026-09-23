import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../lib/project-id.mjs";
import { getStorageRoot } from "../lib/storage-paths.mjs";

const JOB_PREFIX = {
  TRANSCRIBE_VIDEO: "transcribe",
  ANALYZE_VIDEO: "analyze",
  AUTO_EDIT: "autoedit",
  RENDER_CLIP: "render",
  RENDER_NEWS: "newsrender",
  PUBLISH_POST: "publish",
};

export class JobStore {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.staleAfterMs = options.staleAfterMs ?? 15 * 60 * 1000;
  }

  async enqueueTranscription(projectId, options = {}) {
    return this.enqueue("TRANSCRIBE_VIDEO", projectId, {
      payload: options.payload || {},
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueAnalysis(projectId, payload = {}, options = {}) {
    return this.enqueue("ANALYZE_VIDEO", projectId, {
      payload,
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueAutoEdit(projectId, payload = {}, options = {}) {
    return this.enqueue("AUTO_EDIT", projectId, {
      payload,
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueRender(projectId, clipId, payload = {}, options = {}) {
    return this.enqueue("RENDER_CLIP", projectId, {
      entityId: clipId,
      payload: {
        ...sanitizePayload(payload),
        clipId,
      },
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueNewsRender(projectId, payload = {}, options = {}) {
    return this.enqueue("RENDER_NEWS", projectId, {
      payload,
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueuePublish(projectId, publicationId, payload = {}, options = {}) {
    return this.enqueue("PUBLISH_POST", projectId, {
      entityId: publicationId,
      payload: {
        ...sanitizePayload(payload),
        publicationId,
      },
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueue(type, projectId, options = {}) {
    assertProjectId(projectId);
    assertJobType(type);

    const entityId = options.entityId || null;
    if (["RENDER_CLIP", "PUBLISH_POST"].includes(type)) {
      assertProjectId(entityId);
    }

    await this.#ensureDirectory();

    const id = jobId(type, projectId, entityId);
    const existing = await this.get(id);
    const restartCompleted = options.restartCompleted === true;

    if (existing && ["QUEUED", "PROCESSING"].includes(existing.status)) {
      return existing;
    }

    if (existing?.status === "COMPLETED" && !restartCompleted) {
      return existing;
    }

    const now = new Date().toISOString();
    const job = {
      id,
      type,
      projectId,
      entityId,
      payload: sanitizePayload(options.payload),
      status: "QUEUED",
      progress: 0,
      attempts:
        existing?.status === "FAILED" || restartCompleted
          ? 0
          : (existing?.attempts ?? 0),
      maxAttempts: existing?.maxAttempts ?? this.maxAttempts,
      error: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: now,
    };

    await this.#write(job);
    return job;
  }

  async get(id) {
    try {
      return JSON.parse(await readFile(this.#jobPath(id), "utf8"));
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  async getTranscriptionJob(projectId) {
    return this.get(jobId("TRANSCRIBE_VIDEO", projectId));
  }

  async getAnalysisJob(projectId) {
    return this.get(jobId("ANALYZE_VIDEO", projectId));
  }

  async getAutoEditJob(projectId) {
    return this.get(jobId("AUTO_EDIT", projectId));
  }

  async getRenderJob(projectId, clipId) {
    return this.get(jobId("RENDER_CLIP", projectId, clipId));
  }

  async getNewsRenderJob(projectId) {
    return this.get(jobId("RENDER_NEWS", projectId));
  }

  async getPublishJob(projectId, publicationId) {
    return this.get(jobId("PUBLISH_POST", projectId, publicationId));
  }

  async claimNext(allowedTypes = null) {
    await this.#recoverStaleLocks();
    await this.#ensureDirectory();

    const allowed =
      Array.isArray(allowedTypes) && allowedTypes.length > 0
        ? new Set(allowedTypes)
        : null;

    const names = await readdir(this.#jobsDir());
    const now = Date.now();

    for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
      const id = name.slice(0, -5);
      const job = await this.get(id);

      if (
        !job ||
        job.status !== "QUEUED" ||
        (allowed && !allowed.has(job.type)) ||
        Date.parse(job.nextAttemptAt || job.createdAt) > now
      ) {
        continue;
      }

      const locked = await this.#tryLock(id);
      if (!locked) continue;

      const fresh = await this.get(id);
      if (
        !fresh ||
        fresh.status !== "QUEUED" ||
        (allowed && !allowed.has(fresh.type))
      ) {
        await this.release(id);
        continue;
      }

      const updated = {
        ...fresh,
        status: "PROCESSING",
        progress: Number(fresh.progress || 0),
        attempts: Number(fresh.attempts || 0) + 1,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
      };

      await this.#write(updated);
      return updated;
    }

    return null;
  }

  async updateProgress(id, progress) {
    const job = await this.get(id);
    if (!job || job.status !== "PROCESSING") return job;

    const normalized = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    const updated = {
      ...job,
      progress: normalized,
      updatedAt: new Date().toISOString(),
    };

    await this.#write(updated);
    return updated;
  }

  async complete(job) {
    const completed = {
      ...job,
      status: "COMPLETED",
      progress: 100,
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    };

    await this.#write(completed);
    await this.release(job.id);
    return completed;
  }

  async fail(job, error, options = {}) {
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || this.maxAttempts);
    const terminal = options.retryable === false || attempts >= maxAttempts;
    const now = Date.now();
    const delayMs = Math.min(
      5 * 60 * 1000,
      30_000 * 2 ** Math.max(0, attempts - 1),
    );

    const failed = {
      ...job,
      status: terminal ? "FAILED" : "QUEUED",
      updatedAt: new Date(now).toISOString(),
      completedAt: terminal ? new Date(now).toISOString() : null,
      nextAttemptAt: terminal ? null : new Date(now + delayMs).toISOString(),
      error: error instanceof Error ? error.message : String(error),
    };

    await this.#write(failed);
    await this.release(job.id);
    return failed;
  }

  async release(id) {
    await rm(this.#lockPath(id), { force: true });
  }

  async #tryLock(id) {
    try {
      const handle = await open(this.#lockPath(id), "wx");
      await handle.writeFile(new Date().toISOString(), "utf8");
      await handle.close();
      return true;
    } catch (error) {
      if (getErrorCode(error) === "EEXIST") return false;
      throw error;
    }
  }

  async #recoverStaleLocks() {
    await this.#ensureDirectory();
    const names = await readdir(this.#jobsDir());

    for (const name of names.filter((value) => value.endsWith(".lock"))) {
      const lockPath = path.join(this.#jobsDir(), name);

      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs < this.staleAfterMs) continue;

        const id = name.slice(0, -5);
        const job = await this.get(id);

        if (job?.status === "PROCESSING") {
          await this.#write({
            ...job,
            status: "QUEUED",
            updatedAt: new Date().toISOString(),
            nextAttemptAt: new Date().toISOString(),
            error: "Recovered after a stale worker lock.",
          });
        }

        await rm(lockPath, { force: true });
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
    }
  }

  async #write(job) {
    await this.#ensureDirectory();

    const target = this.#jobPath(job.id);
    const temp = `${target}.${process.pid}.${Date.now()}.tmp`;

    await writeFile(temp, JSON.stringify(job, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });

    await rename(temp, target);
  }

  async #ensureDirectory() {
    await mkdir(this.#jobsDir(), { recursive: true });
  }

  #jobsDir() {
    return path.join(getStorageRoot(), "jobs");
  }

  #jobPath(id) {
    return path.join(this.#jobsDir(), `${safeJobId(id)}.json`);
  }

  #lockPath(id) {
    return path.join(this.#jobsDir(), `${safeJobId(id)}.lock`);
  }
}

export function transcriptionJobId(projectId) {
  return jobId("TRANSCRIBE_VIDEO", projectId);
}

export function analysisJobId(projectId) {
  return jobId("ANALYZE_VIDEO", projectId);
}

export function autoEditJobId(projectId) {
  return jobId("AUTO_EDIT", projectId);
}

export function renderJobId(projectId, clipId) {
  return jobId("RENDER_CLIP", projectId, clipId);
}

export function newsRenderJobId(projectId) {
  return jobId("RENDER_NEWS", projectId);
}

export function publishJobId(projectId, publicationId) {
  return jobId("PUBLISH_POST", projectId, publicationId);
}

function jobId(type, projectId, entityId = null) {
  assertProjectId(projectId);
  assertJobType(type);

  if (["RENDER_CLIP", "PUBLISH_POST"].includes(type)) {
    assertProjectId(entityId);
    return `${JOB_PREFIX[type]}-${projectId}-${entityId}`;
  }

  return `${JOB_PREFIX[type]}-${projectId}`;
}

function assertJobType(type) {
  if (!Object.hasOwn(JOB_PREFIX, type)) {
    throw new Error("Unsupported job type.");
  }
}

function safeJobId(value) {
  const text = String(value);

  for (const prefix of ["transcribe", "analyze", "autoedit", "newsrender"]) {
    const marker = `${prefix}-`;
    if (text.startsWith(marker) && isProjectId(text.slice(marker.length))) {
      return text;
    }
  }

  for (const prefix of ["render", "publish"]) {
    const marker = `${prefix}-`;
    if (text.startsWith(marker)) {
      const rest = text.slice(marker.length);
      if (
        rest.length === 73 &&
        rest[36] === "-" &&
        isProjectId(rest.slice(0, 36)) &&
        isProjectId(rest.slice(37))
      ) {
        return text;
      }
    }
  }

  throw new Error("Invalid job id.");
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  return JSON.parse(JSON.stringify(payload));
}

function assertProjectId(projectId) {
  if (!isProjectId(projectId)) throw new Error("Invalid project id.");
}

function getErrorCode(error) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
