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
import { isProjectId } from "../lib/project-id.mjs";
import { getStorageRoot, resolveStoragePath } from "../lib/storage-paths.mjs";
import { validateMp4 } from "./media-processing/MediaValidationService.mjs";
import { leaseOwner,ownerIsAlive } from "../lib/process-lease.mjs";

const JOB_PREFIX = {
  TRANSCRIBE_VIDEO: "transcribe",
  ANALYZE_VIDEO: "analyze",
  AUTO_EDIT: "autoedit",
  RENDER_CLIP: "render",
  RENDER_NEWS: "newsrender",
  OWNED_CONTENT: "ownedcontent",
  PUBLISH_POST: "publish",
  FETCH_ANALYTICS: "analytics",
  MEDIA_STORY: "story",
  MEDIA_EDIT: "videoedit",
  MEDIA_CLIPS: "bestclips",
};

const ENTITY_JOB_TYPES = new Set([
  "RENDER_CLIP",
  "PUBLISH_POST",
  "FETCH_ANALYTICS",
]);

export class JobStore {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts ?? 3;
    this.staleAfterMs = options.staleAfterMs ?? 15 * 60 * 1000;
    this.renderStaleAfterMs = options.renderStaleAfterMs ?? 2 * 60 * 1000;
  }

  async enqueueMedia(type, id, payload = {}) {
    if (!["MEDIA_STORY", "MEDIA_EDIT", "MEDIA_CLIPS"].includes(type)) throw new Error("Unsupported media job.");
    return this.#withMediaMutation(jobId(type, id), async () => {
    const previous = await this.get(jobId(type, id));
    if (previous?.status === "CANCELLED") {
      if (await this.#mediaLockActive(previous.id)) throw Object.assign(new Error("El procesador todavía se está deteniendo. Espera unos segundos para reanudar."), { code: "MEDIA_STOPPING" });
      await this.release(previous.id);
    }
    return this.enqueue(type, id, { payload });
    });
  }

  async listMedia(limit = 30) {
    return (await this.listMediaWithIssues(limit)).jobs;
  }

  async listMediaWithIssues(limit = 30) {
    await this.#ensureDirectory();
    const names = await readdir(this.#jobsDir());
    const files = names.filter(n => /^(story|videoedit|bestclips)-.*\.json$/.test(n));
    const jobs = [], issues = []; let next = 0;
    await Promise.all(Array.from({ length: Math.min(4, files.length) }, async () => {
      while (next < files.length) { const id = files[next++].slice(0, -5); const job = await this.#readRecoverable(id, issues); if (job) jobs.push(job); }
    }));
    return { jobs: jobs.sort((a,b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, Math.min(100, Math.max(1,Number(limit)||30))), issues };
  }

  async transition(id, status, stage, progress = null, patch = {}) {
    const job = await this.get(id);
    if (!job || job.status === "CANCELLED") return job;
    if (status === "CANCELLED" && job.type.startsWith("MEDIA_")) return this.cancelMedia(id);
    if (!["PROCESSING", "VALIDATING", "WAITING_RESOURCE", "FAILED", "CANCELLED"].includes(status)) throw new Error("Invalid media state.");
    const history = [...(job.history || []), { status, stage, at: new Date().toISOString() }].slice(-100);
    const updated = { ...job, ...patch, status, stage, history, updatedAt: new Date().toISOString(),
      progress: progress === null ? job.progress : Math.max(0, Math.min(99, Math.round(progress))) };
    await this.#write(updated); return updated;
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
      payload: { ...sanitizePayload(payload), clipId },
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueNewsRender(projectId, payload = {}, options = {}) {
    return this.enqueue("RENDER_NEWS", projectId, {
      payload,
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueOwnedContent(executionId, payload = {}, options = {}) {
    return this.enqueue("OWNED_CONTENT", executionId, {
      payload: { ...sanitizePayload(payload), executionId },
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueuePublish(projectId, publicationId, payload = {}, options = {}) {
    return this.enqueue("PUBLISH_POST", projectId, {
      entityId: publicationId,
      payload: { ...sanitizePayload(payload), publicationId },
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueueAnalytics(projectId, publicationId, payload = {}, options = {}) {
    return this.enqueue("FETCH_ANALYTICS", projectId, {
      entityId: publicationId,
      payload: { ...sanitizePayload(payload), publicationId },
      restartCompleted: options.restartCompleted ?? false,
    });
  }

  async enqueue(type, projectId, options = {}) {
    assertProjectId(projectId);
    assertJobType(type);

    const entityId = options.entityId || null;
    if (ENTITY_JOB_TYPES.has(type)) assertProjectId(entityId);

    await this.#ensureDirectory();
    const id = jobId(type, projectId, entityId);
    const existing = await this.get(id);
    const restartCompleted = options.restartCompleted === true;

    if (existing && ["QUEUED", "PROCESSING", "VALIDATING"].includes(existing.status)) return existing;
    if (["COMPLETED", "READY"].includes(existing?.status) && !restartCompleted) return existing;

    const now = new Date().toISOString();
    const job = {
      id,
      type,
      projectId,
      entityId,
      ...(type.startsWith("MEDIA_") ? { generation: randomUUID() } : {}),
      payload: sanitizePayload(options.payload),
      status: "QUEUED",
      progress: 0,
      attempts: ["FAILED", "WAITING_RESOURCE", "CANCELLED"].includes(existing?.status) || restartCompleted ? 0 : (existing?.attempts ?? 0),
      maxAttempts: existing?.maxAttempts ?? this.maxAttempts,
      error: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      startedAt: null,
      completedAt: null,
      nextAttemptAt: now,
      stage: "QUEUED",
      history: [...(existing?.history || []), { status: "QUEUED", stage: "QUEUED", at: now }].slice(-100),
    };
    await this.#write(job);
    return job;
  }

  async get(id) {
    try {
      const job = JSON.parse(await readFile(this.#jobPath(id), "utf8"));
      if (!job || job.id !== id || !Object.hasOwn(JOB_PREFIX, job.type) || typeof job.status !== "string" || !isProjectId(job.projectId)) throw invalidMetadata();
      if (job.type.startsWith("MEDIA_")) {
        const marker = await readFile(`${this.#jobPath(id)}.cancel`, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
        if (marker && marker.generation === (job.generation || job.createdAt)) return { ...job, status: "CANCELLED", stage: "CANCELLED", error: null, completedAt: marker.at, nextAttemptAt: null, cancellationPending: await this.#mediaLockActive(id),
          history: [...(job.history || []), { status: "CANCELLED", stage: "CANCELLED", at: marker.at }].slice(-100) };
      }
      return job;
    } catch (error) { if (getErrorCode(error) === "ENOENT") return null; if (error instanceof SyntaxError) throw invalidMetadata(); throw error; }
  }

  async #readRecoverable(id, issues = []) {
    try { safeJobId(id); } catch { issues.push({ id, message: "Identificador de trabajo inválido; se conserva el archivo para revisión." }); return null; }
    try { return await this.get(id); }
    catch (error) { if (error.code !== "JOB_METADATA_INVALID") throw error; issues.push({ id, message: error.message }); return null; }
  }

  async cancelMedia(id) {
    return this.#withMediaMutation(id, async () => {
    const job = await this.get(id);
    if (!job || !job.type.startsWith("MEDIA_")) throw new Error("Trabajo multimedia no encontrado.");
    if (!["QUEUED", "PROCESSING", "VALIDATING", "WAITING_RESOURCE"].includes(job.status)) return job;
    const target = `${this.#jobPath(id)}.cancel`, temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify({ generation: job.generation || job.createdAt, at: new Date().toISOString() }), { flag: "wx" });
    await rename(temporary, target);
    return this.get(id);
    });
  }

  async #withMediaMutation(id, operation) {
    await this.#ensureDirectory();
    const target = `${this.#jobPath(id)}.mutation`, deadline = Date.now() + 5000;
    let handle;
    while (!handle && Date.now() < deadline) {
      try { handle = await open(target, "wx"); }
      catch (error) {
        if (error.code !== "EEXIST") throw error;
        try { const owner = JSON.parse(await readFile(target, "utf8")); if (!ownerIsAlive(owner)) await rm(target, { force: true }); }
        catch { const info = await stat(target).catch(() => null); if (info && Date.now() - info.mtimeMs > 5 * 60 * 1000) await rm(target, { force: true }); }
        await new Promise(resolve => setTimeout(resolve, 20));
      }
    }
    if (!handle) throw Object.assign(new Error("El trabajo está actualizándose. Vuelve a intentarlo en unos segundos."), { code: "MEDIA_BUSY" });
    try { await handle.writeFile(JSON.stringify(leaseOwner())); return await operation(); }
    finally { await handle.close(); await rm(target, { force: true }); }
  }

  async #mediaLockActive(id) {
    const info = await stat(this.#lockPath(id)).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) return false;
    try { const owner = JSON.parse(await readFile(this.#lockPath(id), "utf8")); if (Number.isSafeInteger(owner?.pid)) return ownerIsAlive(owner); }
    catch (error) { if (error.code === "ENOENT") return false; }
    // Do not steal a lease between its exclusive creation and owner write.
    return Date.now() - info.mtimeMs < 5 * 60 * 1000;
  }

  async interruptMedia(job) {
    const fresh = await this.get(job.id);
    if (fresh?.generation !== job.generation) return fresh;
    if (!fresh || fresh.status === "CANCELLED") { await this.release(job.id); return fresh; }
    await this.#write({ ...fresh, status: "QUEUED", stage: "RECOVERED", startedAt: null, nextAttemptAt: new Date().toISOString(), updatedAt: new Date().toISOString(), error: "El procesador se reinició; el trabajo se reanudará desde sus avances verificados." });
    await this.release(job.id); return this.get(job.id);
  }

  async getTranscriptionJob(projectId) { return this.get(jobId("TRANSCRIBE_VIDEO", projectId)); }
  async getAnalysisJob(projectId) { return this.get(jobId("ANALYZE_VIDEO", projectId)); }
  async getAutoEditJob(projectId) { return this.get(jobId("AUTO_EDIT", projectId)); }
  async getRenderJob(projectId, clipId) { return this.get(jobId("RENDER_CLIP", projectId, clipId)); }
  async getNewsRenderJob(projectId) { return this.get(jobId("RENDER_NEWS", projectId)); }
  async getOwnedContentJob(executionId) { return this.get(jobId("OWNED_CONTENT", executionId)); }
  async getPublishJob(projectId, publicationId) { return this.get(jobId("PUBLISH_POST", projectId, publicationId)); }
  async getAnalyticsJob(projectId, publicationId) { return this.get(jobId("FETCH_ANALYTICS", projectId, publicationId)); }

  async claimNext(allowedTypes = null, targetId = null) {
    if(targetId!==null)safeJobId(targetId);
    await this.#recoverStaleJobs();
    await this.#ensureDirectory();
    const allowed = Array.isArray(allowedTypes) && allowedTypes.length > 0 ? new Set(allowedTypes) : null;
    const names = await readdir(this.#jobsDir());
    const now = Date.now();

    for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
      const id = name.slice(0, -5);
      if(targetId!==null&&id!==targetId)continue;
      const job = await this.#readRecoverable(id);
      if (!job || job.status !== "QUEUED" || (allowed && !allowed.has(job.type)) || Date.parse(job.nextAttemptAt || job.createdAt) > now) continue;
      const claim = async () => {
      const locked = await this.#tryLock(id);
      if (!locked) return null;
      const fresh = await this.#readRecoverable(id);
      if (!fresh || fresh.status !== "QUEUED" || (allowed && !allowed.has(fresh.type))) {
        await this.release(id);
        return null;
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
      };
      const claimed = job.type.startsWith("MEDIA_") ? await this.#withMediaMutation(id, claim) : await claim();
      if (claimed) return claimed;
    }
    return null;
  }

  async updateProgress(id, progress) {
    const job = await this.get(id);
    if (!job || job.status !== "PROCESSING") return job;
    const normalized = Math.max(0, Math.min(100, Math.round(Number(progress) || 0)));
    const updated = { ...job, progress: normalized, updatedAt: new Date().toISOString() };
    await this.#write(updated);
    return updated;
  }

  async heartbeat(id) {
    const job = await this.get(id);
    if (!job || !["PROCESSING", "VALIDATING"].includes(job.status)) return false;
    const lockPath = this.#lockPath(id);
    try {
      await stat(lockPath);
      if (job.type.startsWith("MEDIA_")) await writeFile(lockPath, JSON.stringify(leaseOwner()), { encoding: "utf8" });
      else await writeFile(lockPath, new Date().toISOString(), { encoding: "utf8" });
      return true;
    } catch (error) {
      if (getErrorCode(error) === "ENOENT") return false;
      throw error;
    }
  }

  async complete(job) {
    const current = await this.get(job.id);
    if (job.generation && current?.generation !== job.generation) return current;
    if (current?.status === "CANCELLED") { await this.release(job.id); return current; }
    const media = job.type.startsWith("MEDIA_");
    if (media && job.result?.validation?.valid !== true) throw new Error("Media jobs need real validation evidence before READY.");
    if (media) {
      const outputs = job.result.clips || [job.result];
      if (!outputs.length) throw new Error("No media outputs exist.");
      for (const output of outputs) {
        if (!output.relativePath) throw new Error("No result file is associated with this job.");
        output.validation = await validateMp4(resolveStoragePath(output.relativePath), { requireAudio: job.type === "MEDIA_STORY" || output.validation?.audioCodec === "aac", requireAudibleNarration:job.type==="MEDIA_STORY",duration: output.validation?.duration, subtitleValidation: output.validation?.subtitleValidation });
      }
    }
    const fresh = await this.get(job.id);
    if (job.generation && fresh?.generation !== job.generation) return fresh;
    if (fresh?.status === "CANCELLED") { await this.release(job.id); return fresh; }
    const completed = {
      ...job,
      status: media ? "READY" : "COMPLETED",
      stage: media ? "READY" : "COMPLETED",
      history: [...(fresh?.history || job.history || []), { status: media ? "READY" : "COMPLETED", stage: "COMPLETE", at: new Date().toISOString() }].slice(-100),
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
    const fresh = await this.get(job.id);
    if (job.generation && fresh?.generation !== job.generation) return fresh;
    if (fresh?.status === "CANCELLED") { await this.release(job.id); return fresh; }
    const attempts = Number(job.attempts || 0);
    const maxAttempts = Number(job.maxAttempts || this.maxAttempts);
    const terminal = options.retryable === false || attempts >= maxAttempts;
    const now = Date.now();
    const delayMs = Math.min(5 * 60 * 1000, 30_000 * 2 ** Math.max(0, attempts - 1));
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

  async release(id) { await rm(this.#lockPath(id), { force: true }); }

  async #tryLock(id) {
    try {
      const handle = await open(this.#lockPath(id), "wx");
      await handle.writeFile(id.startsWith("story-") || id.startsWith("videoedit-") || id.startsWith("bestclips-") ? JSON.stringify(leaseOwner()) : new Date().toISOString(), "utf8");
      await handle.close();
      return true;
    } catch (error) {
      if (getErrorCode(error) === "EEXIST") return false;
      throw error;
    }
  }

  async #recoverStaleJobs() {
    await this.#ensureDirectory();
    // Serialize recovery across worker processes before replacing any job lock.
    const guard=path.join(this.#jobsDir(),".recovery.guard");let guardHandle;
    try { guardHandle=await open(guard,"wx");await guardHandle.writeFile(JSON.stringify(leaseOwner())); }
    catch(error) {
      if(getErrorCode(error)!=="EEXIST")throw error;
      try { const owner=JSON.parse(await readFile(guard,"utf8"));if(!ownerIsAlive(owner))await rm(guard,{force:true}); } catch { const info=await stat(guard).catch(()=>null);if(info&&Date.now()-info.mtimeMs>5*60*1000)await rm(guard,{force:true}); }
      return;
    }
    try { await this.#recoverUnderGuard(); }
    finally { await guardHandle.close();await rm(guard,{force:true}); }
  }

  async #recoverUnderGuard() {
    const names = await readdir(this.#jobsDir());
    for (const name of names.filter((value) => value.endsWith(".lock"))) {
      const lockPath = path.join(this.#jobsDir(), name);
      try {
        const info = await stat(lockPath);
        const id = name.slice(0, -5);
        const job = await this.#readRecoverable(id);
        if (!job) continue;
        let confirmedDead = false;
        if (job?.type.startsWith("MEDIA_")) {
          try { const owner = JSON.parse(await readFile(lockPath, "utf8")); if (ownerIsAlive(owner)) continue;confirmedDead=Boolean(owner.pid); }
          catch (error) { if (getErrorCode(error) === "ENOENT" || Date.now()-info.mtimeMs<5*60*1000) continue; }
        }
        const staleAfterMs = job?.type === "RENDER_CLIP" ? this.renderStaleAfterMs : this.staleAfterMs;
        if (!confirmedDead && Date.now() - info.mtimeMs < staleAfterMs) continue;
        if (["PROCESSING", "VALIDATING"].includes(job?.status)) {
          await this.#write({
            ...job,
            status: "QUEUED",
            progress: job.type === "RENDER_CLIP" ? 0 : job.progress,
            startedAt: job.type === "RENDER_CLIP" ? null : job.startedAt,
            updatedAt: new Date().toISOString(),
            nextAttemptAt: new Date().toISOString(),
            error: "Recovered after a stale worker lock.",
            stage: "RECOVERED",
            history: [...(job.history||[]),{status:"QUEUED",stage:"RECOVERED",at:new Date().toISOString()}].slice(-100),
          });
        }
        await rm(lockPath, { force: true });
      } catch (error) {
        if (getErrorCode(error) !== "ENOENT") throw error;
      }
    }

    for (const name of names.filter((value) => value.endsWith(".json"))) {
      const id = name.slice(0, -5);
      const job = await this.#readRecoverable(id);
      if (!job || !(job.type === "RENDER_CLIP" || job.type.startsWith("MEDIA_")) || !["PROCESSING", "VALIDATING"].includes(job.status)) continue;
      const lastActivity = Date.parse(job.updatedAt || job.startedAt || job.createdAt);
      if (Number.isFinite(lastActivity) && Date.now() - lastActivity < this.renderStaleAfterMs) continue;
      try { await stat(this.#lockPath(id)); continue; }
      catch (error) { if (getErrorCode(error) !== "ENOENT") throw error; }
      await this.#write({
        ...job,
        status: "QUEUED",
        progress: 0,
        startedAt: null,
        updatedAt: new Date().toISOString(),
        nextAttemptAt: new Date().toISOString(),
        error: "Recovered orphaned render job without an active worker lock.",
      });
    }
  }

  async #write(job) {
    await this.#ensureDirectory();
    const target = this.#jobPath(job.id);
    const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(job, null, 2), { encoding: "utf8", flag: "wx" });
    await rename(temp, target);
  }

  async #ensureDirectory() { await mkdir(this.#jobsDir(), { recursive: true }); }
  #jobsDir() { return path.join(getStorageRoot(), "jobs"); }
  #jobPath(id) { return path.join(this.#jobsDir(), `${safeJobId(id)}.json`); }
  #lockPath(id) { return path.join(this.#jobsDir(), `${safeJobId(id)}.lock`); }
}

function invalidMetadata() { return Object.assign(new Error("No se pudieron leer los metadatos de este trabajo. Se conserva el archivo para revisión o recuperación desde una copia."), { code: "JOB_METADATA_INVALID" }); }

export function transcriptionJobId(projectId) { return jobId("TRANSCRIBE_VIDEO", projectId); }
export function analysisJobId(projectId) { return jobId("ANALYZE_VIDEO", projectId); }
export function autoEditJobId(projectId) { return jobId("AUTO_EDIT", projectId); }
export function renderJobId(projectId, clipId) { return jobId("RENDER_CLIP", projectId, clipId); }
export function newsRenderJobId(projectId) { return jobId("RENDER_NEWS", projectId); }
export function ownedContentJobId(executionId) { return jobId("OWNED_CONTENT", executionId); }
export function publishJobId(projectId, publicationId) { return jobId("PUBLISH_POST", projectId, publicationId); }
export function analyticsJobId(projectId, publicationId) { return jobId("FETCH_ANALYTICS", projectId, publicationId); }

function jobId(type, projectId, entityId = null) {
  assertProjectId(projectId);
  assertJobType(type);
  if (ENTITY_JOB_TYPES.has(type)) {
    assertProjectId(entityId);
    return `${JOB_PREFIX[type]}-${projectId}-${entityId}`;
  }
  return `${JOB_PREFIX[type]}-${projectId}`;
}
function assertJobType(type) { if (!Object.hasOwn(JOB_PREFIX, type)) throw new Error("Unsupported job type."); }
function safeJobId(value) {
  const text = String(value);
  for (const prefix of ["transcribe", "analyze", "autoedit", "newsrender", "ownedcontent", "story", "videoedit", "bestclips"]) {
    const marker = `${prefix}-`;
    if (text.startsWith(marker) && isProjectId(text.slice(marker.length))) return text;
  }
  for (const prefix of ["render", "publish", "analytics"]) {
    const marker = `${prefix}-`;
    if (text.startsWith(marker)) {
      const rest = text.slice(marker.length);
      if (rest.length === 73 && rest[36] === "-" && isProjectId(rest.slice(0, 36)) && isProjectId(rest.slice(37))) return text;
    }
  }
  throw new Error("Invalid job id.");
}
function sanitizePayload(payload) { if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {}; return JSON.parse(JSON.stringify(payload)); }
function assertProjectId(projectId) { if (!isProjectId(projectId)) throw new Error("Invalid project id."); }
function getErrorCode(error) { return error instanceof Error && "code" in error ? error.code : undefined; }
