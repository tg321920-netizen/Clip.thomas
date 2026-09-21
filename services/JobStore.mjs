import { mkdir, open, readFile, readdir, rm, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../lib/project-id.mjs";
import { getStorageRoot } from "../lib/storage-paths.mjs";

const JOB_TYPE = "TRANSCRIBE_VIDEO";

export class JobStore {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.staleAfterMs = options.staleAfterMs ?? 15 * 60 * 1000;
  }

  async enqueueTranscription(projectId) {
    assertProjectId(projectId);
    await this.#ensureDirectory();

    const id = transcriptionJobId(projectId);
    const existing = await this.get(id);

    if (
      existing &&
      ["QUEUED", "PROCESSING", "COMPLETED"].includes(existing.status)
    ) {
      return existing;
    }

    const now = new Date().toISOString();
    const job = {
      id,
      type: JOB_TYPE,
      projectId,
      status: "QUEUED",
      attempts: existing?.status === "FAILED" ? 0 : (existing?.attempts ?? 0),
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
    assertProjectId(projectId);
    return this.get(transcriptionJobId(projectId));
  }

  async claimNext() {
    await this.#recoverStaleLocks();
    await this.#ensureDirectory();

    const names = await readdir(this.#jobsDir());
    const now = Date.now();

    for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
      const id = name.slice(0, -5);
      const job = await this.get(id);

      if (
        !job ||
        job.status !== "QUEUED" ||
        Date.parse(job.nextAttemptAt || job.createdAt) > now
      ) {
        continue;
      }

      const locked = await this.#tryLock(id);
      if (!locked) continue;

      const fresh = await this.get(id);
      if (!fresh || fresh.status !== "QUEUED") {
        await this.release(id);
        continue;
      }

      const updated = {
        ...fresh,
        status: "PROCESSING",
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

  async complete(job) {
    const completed = {
      ...job,
      status: "COMPLETED",
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    };

    await this.#write(completed);
    await this.release(job.id);
    return completed;
  }

  async fail(job, error) {
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || this.maxAttempts);
    const terminal = attempts >= maxAttempts;
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
  assertProjectId(projectId);
  return `transcribe-${projectId}`;
}

function safeJobId(value) {
  if (!/^transcribe-[0-9a-f-]+$/i.test(String(value))) {
    throw new Error("Invalid job id.");
  }
  return String(value);
}

function assertProjectId(projectId) {
  if (!isProjectId(projectId)) throw new Error("Invalid project id.");
}

function getErrorCode(error) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
