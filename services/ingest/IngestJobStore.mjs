import {
  mkdir,
  open,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { leaseOwner, ownerIsAlive } from "../../lib/process-lease.mjs";
import { withLocalStateLock, writeAtomicJson } from "../../lib/atomic-local-state.mjs";

export class IngestJobStore {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.staleAfterMs = options.staleAfterMs ?? 2 * 60 * 1000;
    this.claims = new Map();
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
      type: input.captureSession === true ? "LIVE_CAPTURE" : "INGEST_URL",
      priority: 50,
      source: {
        autoClip: mode === "STREAM" && input.autoClip === true,
        ...(input.analysisProvider === "heuristic" ? { analysisProvider: "heuristic" } : {}),
        ...(mode === "STREAM" ? normalizeLiveClipSettings(input) : {}),
        clipDuration: Math.max(15, Math.min(90, Number(input.clipDuration) || 30)),
        contentProfile: String(input.contentProfile || "GAMING"),
        subtitles: input.subtitles !== false,
        onlyChatReactions: input.onlyChatReactions === true,
        preferChatReactions: input.preferChatReactions === true,
        chatReactionLagSeconds: Math.max(0, Math.min(30, Number(input.chatReactionLagSeconds) || 0)),
        excludedReactionPeaks: (Array.isArray(input.excludedReactionPeaks) ? input.excludedReactionPeaks : []).filter(t => Number.isFinite(Date.parse(t))).slice(-256),
        captureChat: input.captureChat !== false,
        startTimeSeconds: mode === "STREAM" ? normalizeStartTime(input.startTimeSeconds) : 0,
        kind: mode === "STREAM" ? "STREAM_URL" : "URL",
        ...(input.captureSession === true ? { expectedSource: input.expectedSource, captureSession: true } : {}),
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

  async enqueueLiveWindow({ id, sessionId, coreIndex, segmentIndices, priority = 0, ownershipStartUtc, ownershipEndUtc, onlyChatReactions = true, preferChatReactions = false, chatReactionLagSeconds = 0 }) {
    assertId(id); assertId(sessionId);
    if (!Number.isSafeInteger(coreIndex) || coreIndex < 0 || !Array.isArray(segmentIndices) || segmentIndices.length > 3 ||
      !segmentIndices.every(i => Number.isSafeInteger(i) && i >= 0)) throw new Error("Ventana de captura no válida.");
    const existing = await this.get(id); if (existing) return existing;
    const now = new Date().toISOString();
    const job = { id, projectId: id, type: "INGEST_LIVE_WINDOW", priority: Math.max(0, Math.min(100, Number(priority) || 0)),
      source: { mode: "WINDOW", sessionId, coreIndex, segmentIndices, ownershipStartUtc, ownershipEndUtc, onlyChatReactions, preferChatReactions, chatReactionLagSeconds,
        clipCount: 10, clipDuration: 30, contentProfile: "ENTERTAINMENT", subtitles: false, analysisProvider: "heuristic", autoClip: true, clipMode: "CAPTURE" },
      status: "QUEUED", stage: "QUEUED", progress: 0, attempts: 0, maxAttempts: this.maxAttempts, error: null, result: null,
      createdAt: now, updatedAt: now, startedAt: null, completedAt: null, nextAttemptAt: now };
    await this.#write(job); return job;
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

  async claimNext(allowedTypes = null, targetId = null) {
    if(targetId!==null)assertId(targetId);
    await this.#recoverStale();
    await this.#ensureDirectory();
    const names = (await readdir(this.#jobsDir()))
      .filter((name) => name.endsWith(".json"))
      .sort();
    const now = Date.now();

    const available = (await Promise.all(names.map(name => this.get(name.slice(0,-5))))).filter(Boolean);
    const priority = job => Number(job.priority || 0) + Math.min(100, Math.floor((now - Date.parse(job.createdAt)) / 60000));
    available.sort((a,b) => priority(b) - priority(a) || a.createdAt.localeCompare(b.createdAt));
    for (const job of available) {
      const id = job.id;
      if (
        !job ||
        (allowedTypes && !allowedTypes.includes(job.type)) ||
        (targetId !== null && id !== targetId) ||
        job.status !== "QUEUED" ||
        Date.parse(job.nextAttemptAt || job.createdAt) > now
      ) continue;

      const claimed = await this.#withMutation(id, async () => {
      // Recheck eligibility under the same lock used by retry and recovery.
      const candidate = await this.get(id);
      if (!candidate || candidate.status !== 'QUEUED' || Date.parse(candidate.nextAttemptAt || candidate.createdAt) > Date.now()) return null;
      const claimId = randomUUID();
      const locked = await this.#tryLock(id, claimId);
      if (!locked) return null;

      const fresh = await this.get(id);
      if (!fresh || fresh.status !== "QUEUED") {
        await this.release(id, claimId);
        return null;
      }

      const updated = {
        ...fresh,
        claimId,
        status: "PROCESSING",
        stage: fresh.stage === "QUEUED" ? "VALIDATING" : fresh.stage,
        attempts: Number(fresh.attempts || 0) + 1,
        startedAt: fresh.startedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        error: null,
      };
      try { await this.#write(updated); }
      catch (error) { await this.release(id, claimId); throw error; }
      this.claims.set(id, claimId);
      return updated;
      });
      if (claimed) return claimed;
    }

    return null;
  }

  async update(id, patch = {}) {
    return this.#withMutation(id, async () => {
    const job = await this.get(id);
    if (!job) return null;
    if (job.status === 'CANCELLED') return job;
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
    });
  }

  async updateProgress(id, progress, stage = null, details = null) {
    return this.#withMutation(id, async () => {
    const job = await this.get(id);
    if (!job || job.status !== "PROCESSING") return job;
    if (this.claims.has(id) && this.claims.get(id) !== job.claimId) return job;
    const updated = { ...job,
      progress: Math.max(0, Math.min(99, Math.round(Number(progress) || 0))),
      ...(stage ? { stage: String(stage) } : {}),
      ...(details ? { details: { chatStatus: String(details.chatStatus || "UNAVAILABLE"), acceptedMessages: Math.max(0, Math.round(Number(details.acceptedMessages) || 0)) } } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.#write(updated);
    return updated;
    });
  }

  async heartbeat(id) {
    assertId(id);
    let handle;
    try {
      const job = await this.get(id);
      if (!job || job.status !== 'PROCESSING' || (this.claims.has(id) && this.claims.get(id) !== job.claimId)) return false;
      // Opening an existing inode avoids resurrecting a lease after complete().
      handle = await open(this.#lockPath(id), 'r+');
      let owner;
      try { owner = JSON.parse(await handle.readFile('utf8')); }
      catch (error) { if (error instanceof SyntaxError) return false; throw error; }
      const current = leaseOwner();
      if (owner?.pid !== current.pid || owner.key !== current.key || owner.claimId !== job.claimId) return false;
      const now = new Date();
      await handle.utimes(now, now);
      return true;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") return false;
      throw error;
    } finally { await handle?.close(); }
  }

  async cancel(id) {
    return this.#withMutation(id, async () => {
    const job = await this.get(id);
    if (!job || ["COMPLETED", "FAILED", "CANCELLED"].includes(job.status)) return job;
    await writeFile(`${this.#jobPath(id)}.cancel`, new Date().toISOString(), "utf8");
    return this.get(id);
    });
  }

  async complete(job, result) {
    return this.#withMutation(job.id, async () => {
    const fresh = await this.get(job.id);
    if (!sameAttempt(job, fresh)) return fresh;
    if (fresh?.status === "CANCELLED") { await this.release(job.id, job.claimId); return fresh; }
    if (fresh?.status !== 'PROCESSING') return fresh;
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
    await this.release(job.id, job.claimId);
    return completed;
    });
  }

  async fail(job, error, options = {}) {
    return this.#withMutation(job.id, async () => {
    const fresh = await this.get(job.id);
    if (!sameAttempt(job, fresh)) return fresh;
    if (fresh?.status === "CANCELLED") { await this.release(job.id, job.claimId); return fresh; }
    if (fresh?.status !== 'PROCESSING') return fresh;
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
    await this.release(job.id, job.claimId);
    return failed;
    });
  }

  async retry(id) {
    return this.#withMutation(id, async () => {
    const job = await this.get(id);
    if (!job) return null;
    if (!new Set(["FAILED", "QUEUED", "CANCELLED"]).has(job.status)) {
      throw new Error(`Ingest job cannot be retried from ${job.status}.`);
    }
    if ((await this.#leaseState(id)).active) throw new Error("La captura todavía está deteniéndose. Espera unos segundos antes de reanudar.");
    await rm(`${this.#jobPath(id)}.cancel`, { force: true });
    const retried = {
      ...job,
      claimId: null,
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
    });
  }

  async release(id, claimId = null) {
    assertId(id);
    if (claimId) {
      try {
        const owner = JSON.parse(await readFile(this.#lockPath(id), 'utf8'));
        if (owner.claimId !== claimId) return false;
      } catch (error) { if (getErrorCode(error) === 'ENOENT') return false; throw error; }
    }
    await rm(this.#lockPath(id), { force: true });
    if (!claimId || this.claims.get(id) === claimId) this.claims.delete(id);
    return true;
  }

  async #recoverStale() {
    await this.#ensureDirectory();
    const names = await readdir(this.#jobsDir());
    for (const name of names.filter((name) => name.endsWith(".json"))) {
      const id = name.slice(0, -5);
      await this.#withMutation(id, async () => {
      const job = await this.get(id);
      if (!job || !['PROCESSING', 'QUEUED'].includes(job.status)) return;
      const lease = await this.#leaseState(id);
      if (lease.active) return;
      if (job.status === 'QUEUED') { if (lease.exists) await this.release(id); return; }
      // A missing file immediately after an old deployment is not proof that
      // the last known work is already stale. Fresh claims are serialized.
      if (!lease.exists && Date.now() - Date.parse(job.updatedAt || job.createdAt) < this.staleAfterMs) return;

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
      });
    }
  }

  async #tryLock(id, claimId) {
    let handle;
    try {
      handle = await open(this.#lockPath(id), "wx");
      await handle.writeFile(JSON.stringify({ ...leaseOwner(), claimId }), "utf8");
      await handle.close(); handle = null;
      return true;
    } catch (error) {
      if (handle) { await handle.close().catch(() => {}); await rm(this.#lockPath(id), { force: true }); }
      if (getErrorCode(error) === "EEXIST") return false;
      throw error;
    }
  }

  async #write(job) {
    await this.#ensureDirectory();
    await writeAtomicJson(this.#jobPath(job.id), job);
  }

  async #withMutation(id, action) {
    return withLocalStateLock(`${this.#jobPath(id)}.state`, action, { staleMs: 0 });
  }

  async #leaseState(id) {
    try {
      const info = await stat(this.#lockPath(id));
      const contents = await readFile(this.#lockPath(id), 'utf8');
      let owner;
      try { owner = JSON.parse(contents); } catch (error) { if (!(error instanceof SyntaxError)) throw error; }
      if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) return { exists: true, active: ownerIsAlive(owner) };
      // Timestamp leases from prior versions remain supported. An incomplete
      // create needs a grace period before it can safely be recovered.
      const grace = Number.isFinite(Date.parse(contents)) ? this.staleAfterMs : Math.max(5000, this.staleAfterMs);
      return { exists: true, active: Date.now() - info.mtimeMs < grace };
    } catch (error) { if (getErrorCode(error) === 'ENOENT') return { exists: false, active: false }; throw error; }
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

function sameAttempt(previous, current) {
  if (!current) return false;
  if (previous.claimId || current.claimId) return Boolean(previous.claimId && previous.claimId === current.claimId);
  return previous.attempts === current.attempts && previous.startedAt === current.startedAt;
}


export function normalizeLiveClipSettings(input = {}) {
  // Older jobs keep their incremental one-per-segment behavior.
  const clipMode = String(input.clipMode || (input.clipCount === undefined ? "SEGMENTS" : "CAPTURE")).toUpperCase();
  if (!["CAPTURE", "SEGMENTS"].includes(clipMode)) throw new Error("El modo de clips debe ser CAPTURE o SEGMENTS.");
  const clipCount = Number(input.clipCount ?? 5);
  if (!Number.isSafeInteger(clipCount) || clipCount < 1 || clipCount > 10) throw new Error("Elige una cantidad total de 1 a 10 clips.");
  return { clipMode, clipCount };
}
