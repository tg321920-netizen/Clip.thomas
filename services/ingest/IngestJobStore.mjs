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
import { randomUUID } from "node:crypto";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";

export class IngestJobStore {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.staleAfterMs = options.staleAfterMs ?? 2 * 60 * 1000;
  }

  async enqueueUpload(input) {
    assertId(input.id);
    await this.#ensureDirectory();
    const existing = await this.get(input.id);
    if (existing) return existing;
    const now = new Date().toISOString();
    const job = { id: input.id, projectId: input.id, type: "INGEST_UPLOAD",
      source: { kind: "FILE", mode: "UPLOAD", relativePath: input.relativePath,
        filename: input.filename, size: input.size, sha256: input.sha256 },
      status: "QUEUED", stage: "QUEUED", progress: 0, attempts: 0, maxAttempts: this.maxAttempts,
      error: null, result: null, createdAt: now, updatedAt: now, startedAt: null,
      completedAt: null, nextAttemptAt: now };
    await this.#write(job);
    return job;
  }

  async create(input = {}) {
    await this.#ensureDirectory();
    const now = new Date().toISOString();
    const id = input.id || randomUUID();
    assertId(id);
    // Internal monitor retries use a deterministic id, even after a crash
    // between enqueue and checkpoint. The HTTP endpoint never accepts an id.
    if (input.id) { const existing = await this.get(id); if (existing) return existing; }
    const mode = String(input.mode || "IMPORT").trim().toUpperCase();
    if (!new Set(["IMPORT", "STREAM"]).has(mode)) {
      throw new Error("Unsupported ingest mode.");
    }

    const job = {
      id,
      projectId: id,
      type: "INGEST_URL",
      source: {
        autoClip: mode === "STREAM" && input.autoClip === true,
        ...(input.analysisProvider === "heuristic" ? { analysisProvider: "heuristic" } : {}),
        ...(mode === "STREAM" ? normalizeLiveClipSettings(input) : {}),
        clipDuration: Math.max(15, Math.min(90, Number(input.clipDuration) || 30)),
        contentProfile: String(input.contentProfile || "GAMING"),
        subtitles: input.subtitles !== false,
        onlyChatReactions: input.onlyChatReactions === true,
        excludedReactionPeaks: (Array.isArray(input.excludedReactionPeaks) ? input.excludedReactionPeaks : []).filter(t => Number.isFinite(Date.parse(t))).slice(-256),
        captureChat: input.captureChat !== false,
        startTimeSeconds: mode === "STREAM" ? normalizeStartTime(input.startTimeSeconds) : 0,
        kind: mode === "STREAM" ? "STREAM_URL" : "URL",
        url: String(input.url || ""),
        mode,
        captureSeconds:
          mode === "STREAM" ? normalizeCaptureSeconds(input.captureSeconds) : null,
        segmentSeconds:
          mode === "STREAM" ? normalizeSegmentSeconds(input.segmentSeconds) : null,
      },
      status: "QUEUED",
      stage: "QUEUED",
      progress: 0,
      attempts: 0,
      maxAttempts: this.maxAttempts,
      error: null,
      result: null,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: now,
    };

    await this.#write(job);
    return job;
  }

  async get(id) {
    assertId(id);
    try {
      const job = JSON.parse(await readFile(this.#jobPath(id), "utf8"));
      try {
        const cancelledAt = await readFile(`${this.#jobPath(id)}.cancel`, "utf8");
        return { ...job, status: "CANCELLED", stage: "CANCELLED", completedAt: cancelledAt, nextAttemptAt: null };
      } catch (error) { if (getErrorCode(error) !== "ENOENT") throw error; }
      return job;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") return null;
      throw error;
    }
  }

  async list(limit = 50) {
    await this.#ensureDirectory();
    const names = await readdir(this.#jobsDir());
    const jobs = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map((name) => this.get(name.slice(0, -5)).catch(() => null)),
    );
    return jobs
      .filter(Boolean)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 50, 500)));
  }

  async claimNext() {
    await this.#recoverStale();
    await this.#ensureDirectory();
    const names = (await readdir(this.#jobsDir()))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const now = Date.now();

    for (const name of names) {
      const id = name.slice(0, -5);
      const job = await this.get(id);
      if (
        !job ||
        job.status !== "QUEUED" ||
        Date.parse(job.nextAttemptAt || job.createdAt) > now
      ) continue;

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
        stage: fresh.stage === "QUEUED" ? "VALIDATING" : fresh.stage,
        attempts: Number(fresh.attempts || 0) + 1,
        startedAt: fresh.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
      };
      await this.#write(updated);
      return updated;
    }

    return null;
  }

  async update(id, patch = {}) {
    const job = await this.get(id);
    if (!job) return null;
    const updated = {
      ...job,
      ...patch,
      id: job.id,
      projectId: job.projectId,
      source: patch.source ? { ...job.source, ...patch.source } : job.source,
      updatedAt: new Date().toISOString(),
    };
    await this.#write(updated);
    return updated;
  }

  async updateProgress(id, progress, stage = null, details = null) {
    const job = await this.get(id);
    if (!job || job.status !== "PROCESSING") return job;
    return this.update(id, {
      progress: Math.max(0, Math.min(99, Math.round(Number(progress) || 0))),
      ...(stage ? { stage: String(stage) } : {}),
      ...(details ? { details: { chatStatus: String(details.chatStatus || "UNAVAILABLE"), acceptedMessages: Math.max(0, Math.round(Number(details.acceptedMessages) || 0)) } } : {}),
    });
  }

  async heartbeat(id) {
    assertId(id);
    try {
      await writeFile(this.#lockPath(id), new Date().toISOString(), {
        encoding: "utf8",
      });
      return true;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  async cancel(id) {
    const job = await this.get(id);
    if (!job || ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
    await writeFile(`${this.#jobPath(id)}.cancel`, new Date().toISOString(), "utf8");
    return this.get(id);
  }

  async complete(job, result) {
    const fresh = await this.get(job.id);
    if (fresh?.status === "CANCELLED") { await this.release(job.id); return fresh; }
    job = fresh || job;
    const completed = {
      ...job,
      status: "COMPLETED",
      stage: "COMPLETED",
      progress: 100,
      result,
      error: null,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      nextAttemptAt: null,
    };
    await this.#write(completed);
    await this.release(job.id);
    return completed;
  }

  async fail(job, error, options = {}) {
    const fresh = await this.get(job.id);
    if (fresh?.status === "CANCELLED") { await this.release(job.id); return fresh; }
    job = fresh || job;
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || this.maxAttempts);
    const retryable = options.retryable !== false;
    const terminal = !retryable || attempts >= maxAttempts;
    const delayMs = Math.min(
      5 * 60 * 1000,
      30_000 * 2 ** Math.max(0, attempts - 1),
    );
    const now = Date.now();
    const failed = {
      ...job,
      status: terminal ? "FAILED" : "QUEUED",
      stage: terminal ? "FAILED" : "RETRY_WAIT",
      error: error instanceof Error ? error.message : String(error),
      retryable,
      updatedAt: new Date(now).toISOString(),
      completedAt: terminal ? new Date(now).toISOString() : null,
      nextAttemptAt: terminal ? null : new Date(now + delayMs).toISOString(),
    };
    await this.#write(failed);
    await this.release(job.id);
    return failed;
  }

  async retry(id) {
    const job = await this.get(id);
    if (!job) return null;
    if (!new Set(["FAILED", "QUEUED", "CANCELLED"]).has(job.status)) {
      throw new Error(`Ingest job cannot be retried from ${job.status}.`);
    }
    if (job.status === "CANCELLED") {
      try {
        const lock = await stat(this.#lockPath(id));
        if (Date.now() - lock.mtimeMs < this.staleAfterMs) throw new Error("La captura todavía está deteniéndose. Espera unos segundos antes de reanudar.");
      } catch (error) { if (getErrorCode(error) !== "ENOENT") throw error; }
    }
    await rm(`${this.#jobPath(id)}.cancel`, { force: true });
    const retried = {
      ...job,
      status: "QUEUED",
      stage: "QUEUED",
      progress: 0,
      attempts: 0,
      error: null,
      result: null,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.#write(retried);
    await this.release(id);
    return retried;
  }

  async release(id) {
    assertId(id);
    await rm(this.#lockPath(id), { force: true });
  }

  async #recoverStale() {
    await this.#ensureDirectory();
    const names = await readdir(this.#jobsDir());
    const now = Date.now();

    for (const name of names.filter((name) => name.endsWith(".json"))) {
      const id = name.slice(0, -5);
      const job = await this.get(id);
      if (!job || job.status !== "PROCESSING") continue;

      let lockAge = Infinity;
      try {
        const info = await stat(this.#lockPath(id));
        lockAge = now - info.mtimeMs;
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }

      if (lockAge < this.staleAfterMs) continue;

      const exhausted = Number(job.attempts || 0) >= Number(job.maxAttempts || this.maxAttempts);
      await this.#write({
        ...job,
        status: exhausted ? "FAILED" : "QUEUED",
        stage: exhausted ? "FAILED" : "RECOVERED",
        retryable: !exhausted,
        completedAt: exhausted ? new Date().toISOString() : null,
        error: "Recovered after an interrupted ingest worker.",
        updatedAt: new Date().toISOString(),
        nextAttemptAt: exhausted ? null : new Date().toISOString(),
      });
      await this.release(id);
    }
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

  async #write(job) {
    await this.#ensureDirectory();
    const target = this.#jobPath(job.id);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
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
    return path.join(getStorageRoot(), "ingest-jobs");
  }

  #jobPath(id) {
    assertId(id);
    return path.join(this.#jobsDir(), `${id}.json`);
  }

  #lockPath(id) {
    assertId(id);
    return path.join(this.#jobsDir(), `${id}.lock`);
  }
}

export function normalizeStartTime(value) {
  const seconds = value === undefined ? 0 : Number(value);
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 86400) throw new Error("El comienzo de la captura debe estar entre 0 y 86400 segundos.");
  return seconds;
}

function normalizeCaptureSeconds(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 30;
  return Math.max(5, Math.min(24 * 60 * 60, number));
}

function normalizeSegmentSeconds(value) {
  const number = Math.round(Number(value));
  if (!Number.isFinite(number)) return 5 * 60;
  return Math.max(30, Math.min(15 * 60, number));
}

function assertId(id) {
  if (!isProjectId(id)) throw new Error("Invalid ingest job id.");
}

function getErrorCode(error) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}


export function normalizeLiveClipSettings(input = {}) {
  // Older jobs keep their incremental one-per-segment behavior.
  const clipMode = String(input.clipMode || (input.clipCount === undefined ? "SEGMENTS" : "CAPTURE")).toUpperCase();
  if (!["CAPTURE", "SEGMENTS"].includes(clipMode)) throw new Error("El modo de clips debe ser CAPTURE o SEGMENTS.");
  const clipCount = Number(input.clipCount ?? 5);
  if (!Number.isSafeInteger(clipCount) || clipCount < 1 || clipCount > 10) throw new Error("Elige una cantidad total de 1 a 10 clips.");
  return { clipMode, clipCount };
}
