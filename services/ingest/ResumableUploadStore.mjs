import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { sanitizeOriginalName, validateUploadDescriptor } from "../../lib/upload-policy.mjs";
import { writeAll } from "../../lib/write-all.mjs";

export const UPLOAD_CHUNK_BYTES = 2 * 1024 * 1024;
const TTL_MS = 48 * 60 * 60 * 1000;

export class UploadError extends Error {
  constructor(message, code = "UPLOAD_INVALID", status = 400) {
    super(message); this.code = code; this.status = status;
  }
}

/** Single-host disk storage; uses capabilities in addition to existing owner auth. */
export class ResumableUploadStore {
  constructor(options = {}) { this.root = options.root || getStorageRoot(); }
  directory(id) {
    if (!isProjectId(id)) throw new UploadError("Identificador de subida inválido.");
    return path.join(this.root, "upload-sessions", id);
  }
  async create(input) {
    const filename = sanitizeOriginalName(String(input.filename || ""));
    const validation = validateUploadDescriptor({ filename, mimeType: input.mimeType, size: input.size });
    if (!validation.ok || !Number.isSafeInteger(input.size)) throw new UploadError(validation.error || "Tamaño inválido.");
    await this.cleanup();
    const root = path.join(this.root, "upload-sessions");
    const active = await Promise.all((await readdir(root)).filter(isProjectId).map(async id => {
      const value = await readFile(path.join(root, id, "session.json"), "utf8").then(JSON.parse).catch(() => null);
      return value && value.status !== "QUEUED";
    }));
    if (active.filter(Boolean).length >= 64) throw new UploadError("Hay demasiadas subidas pendientes. Intenta más tarde.", "UPLOAD_CAPACITY", 429);
    const id = randomUUID(), token = randomBytes(32).toString("hex");
    const session = { id, filename, mimeType: input.mimeType, size: input.size, extension: validation.extension,
      tokenHash: digest(token), chunkSize: UPLOAD_CHUNK_BYTES, chunkCount: Math.ceil(input.size / UPLOAD_CHUNK_BYTES),
      status: "RECEIVING", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + TTL_MS).toISOString(), sha256: null };
    await mkdir(this.directory(id)); await this.save(session);
    return { ...publicSession(session), token, received: [] };
  }
  async load(id, token) {
    let session;
    try { session = JSON.parse(await readFile(path.join(this.directory(id), "session.json"), "utf8")); }
    catch (error) { if (error.code === "ENOENT") throw new UploadError("La subida expiró o ya no existe. Selecciona el archivo nuevamente.", "UPLOAD_NOT_FOUND", 404); throw error; }
    const expected = Buffer.from(session.tokenHash, "hex"), actual = Buffer.from(digest(String(token || "")), "hex");
    if (!timingSafeEqual(expected, actual)) throw new UploadError("No tienes autorización para esta subida.", "UPLOAD_UNAUTHORIZED", 403);
    if (session.status === "RECEIVING" && Date.parse(session.expiresAt) <= Date.now()) throw new UploadError("La subida expiró. Selecciona el archivo nuevamente.", "UPLOAD_EXPIRED", 410);
    return session;
  }
  async status(id, token) {
    const session = await this.load(id, token);
    const names = await readdir(this.directory(id));
    const diskIndices = names.filter(n => /^chunk-\d+$/.test(n) && names.includes(`${n}.sha256`)).map(n => Number(n.slice(6))).sort((a,b) => a-b);
    const diskHashes = await Promise.all(diskIndices.map(async index => {
      const value = await readFile(path.join(this.directory(id), `chunk-${index}.sha256`), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; });
      return value ? [index, value] : null;
    }));
    const receivedHashes = session.chunkHashes || Object.fromEntries(diskHashes.filter(Boolean));
    const received = Object.keys(receivedHashes).map(Number).sort((a,b) => a-b);
    return { ...publicSession(session), received, receivedHashes,
      bytesReceived: session.status === "QUEUED" || session.status === "ASSEMBLED" ? session.size : received.reduce((sum, index) => sum + this.expectedSize(session, index), 0) };
  }
  expectedSize(session, index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= session.chunkCount) throw new UploadError("Índice de fragmento inválido.", "CHUNK_INDEX_INVALID");
    return Math.min(session.chunkSize, session.size - index * session.chunkSize);
  }
  async putChunk(id, token, index, body, expectedHash, signal) {
    const session = await this.load(id, token);
    if (!/^[a-f0-9]{64}$/i.test(String(expectedHash))) throw new UploadError("Falta la comprobación SHA-256 del fragmento.", "CHUNK_HASH_INVALID");
    const expectedSize = this.expectedSize(session, index);
    return this.lock(id, async () => {
      const fresh = await this.load(id, token);
      if (fresh.status !== "RECEIVING") throw new UploadError("La subida ya fue finalizada.", "UPLOAD_FINALIZED", 409);
      const target = path.join(this.directory(id), `chunk-${index}`);
      try {
        const existing = await stat(target);
        if (existing.size === expectedSize && await hashFile(target) === expectedHash.toLowerCase()) {
          await writeFile(`${target}.sha256`, expectedHash.toLowerCase());
          return { index, duplicate: true, size: expectedSize };
        }
        const committedHash = await readFile(`${target}.sha256`, "utf8").catch(() => null);
        if (committedHash !== expectedHash.toLowerCase()) throw new UploadError("Ese fragmento ya existe con otro contenido.", "CHUNK_CONFLICT", 409);
        // A damaged disk chunk can be repaired with the same committed content.
      } catch (error) { if (error.code !== "ENOENT") throw error; }
      const temporary = `${target}.${randomUUID()}.part`;
      let handle, bytes = 0; const hash = createHash("sha256");
      try {
        handle = await open(temporary, "wx");
        for await (const raw of body) {
          if (signal?.aborted) throw new UploadError("Conexión interrumpida. Puedes reanudar la subida.", "UPLOAD_INTERRUPTED", 409);
          const data = Buffer.from(raw); bytes += data.length;
          if (bytes > expectedSize) throw new UploadError("El fragmento supera su tamaño declarado.", "CHUNK_SIZE_INVALID", 413);
          hash.update(data); await writeAll(handle, data);
        }
        if (bytes !== expectedSize) throw new UploadError(`Fragmento incompleto: recibidos ${bytes} de ${expectedSize} bytes. Reintenta este fragmento.`, "CHUNK_INCOMPLETE", 409);
        if (hash.digest("hex") !== expectedHash.toLowerCase()) throw new UploadError("El fragmento llegó con errores de integridad. Se puede reintentar.", "CHUNK_HASH_MISMATCH", 422);
        await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, target);
        await writeFile(`${target}.sha256`, expectedHash.toLowerCase());
        await this.save({ ...fresh, updatedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + TTL_MS).toISOString() });
        return { index, duplicate: false, size: bytes };
      } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }); }
    });
  }
  async finalize(id, token, enqueue) {
    return this.lock(id, async () => {
      const session = await this.load(id, token);
      if (session.status === "QUEUED") return publicSession(session);
      if (session.status === "ASSEMBLED") return this.enqueueAssembled(session, enqueue);
      const chunkHashes = {};
      for (let index = 0; index < session.chunkCount; index++) {
        const info = await stat(path.join(this.directory(id), `chunk-${index}`)).catch(() => null);
        const chunkPath = path.join(this.directory(id), `chunk-${index}`);
        const expectedHash = await readFile(`${chunkPath}.sha256`, "utf8").catch(() => null);
        if (!expectedHash || info?.size !== this.expectedSize(session, index)) throw new UploadError(`Falta el fragmento ${index + 1}. Reanuda la subida.`, "CHUNKS_MISSING", 409);
        if (await hashFile(chunkPath) !== expectedHash) throw new UploadError(`El fragmento ${index + 1} fue alterado en disco. Reintenta la subida.`, "UPLOAD_INTEGRITY_FAILED", 422);
        chunkHashes[index] = expectedHash;
      }
      const outputDir = path.join(this.root, "uploads", id); await mkdir(outputDir, { recursive: true });
      const relativePath = path.posix.join("uploads", id, `source.${session.extension}`);
      const target = path.join(this.root, relativePath), temporary = `${target}.part`;
      let handle; const hash = createHash("sha256");
      try {
        handle = await open(temporary, "w");
        for (let index = 0; index < session.chunkCount; index++) {
          for await (const chunk of createReadStream(path.join(this.directory(id), `chunk-${index}`))) {
            hash.update(chunk); await writeAll(handle, chunk);
          }
        }
        if ((await handle.stat()).size !== session.size) throw new UploadError("El archivo reconstruido tiene un tamaño incorrecto.", "UPLOAD_INTEGRITY_FAILED", 422);
        await handle.sync(); await handle.close(); handle = null;
        await rename(temporary, target);
        const sha256 = hash.digest("hex");
        // Persist assembly BEFORE publishing the job. Retrying an interrupted
        // enqueue must never replace a source that a worker is already reading.
        const assembled = { ...session, status: "ASSEMBLED", relativePath, sha256, chunkHashes, updatedAt: new Date().toISOString() };
        await this.save(assembled);
        return this.enqueueAssembled(assembled, enqueue);
      } finally { await handle?.close().catch(() => {}); await rm(temporary, { force: true }); }
    });
  }
  async enqueueAssembled(session, enqueue) {
    const filename = path.join(this.root, session.relativePath);
    if ((await stat(filename)).size !== session.size || await hashFile(filename) !== session.sha256) {
      throw new UploadError("El original reconstruido fue alterado. Se conserva para diagnóstico.", "UPLOAD_INTEGRITY_FAILED", 422);
    }
    await enqueue({ id: session.id, relativePath: session.relativePath, filename: session.filename,
      mimeType: session.mimeType, size: session.size, sha256: session.sha256 });
    const completed = { ...session, status: "QUEUED", updatedAt: new Date().toISOString() };
    await this.save(completed);
    for (let index = 0; index < session.chunkCount; index++) {
      await rm(path.join(this.directory(session.id), `chunk-${index}`), { force: true });
      await rm(path.join(this.directory(session.id), `chunk-${index}.sha256`), { force: true });
    }
    return publicSession(completed);
  }
  async save(session) {
    const target = path.join(this.directory(session.id), "session.json"), temp = `${target}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(session), { flag: "wx", mode: 0o600 }); await rename(temp, target);
  }
  async lock(id, operation) {
    const lock = path.join(this.directory(id), "lock"); let handle;
    try { handle = await open(lock, "wx"); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // Never steal a live writer's lock. A dead process is recoverable on this single-host runtime.
      const owner = Number(await readFile(lock, "utf8").catch(() => "0"));
      let alive = true;
      if (owner > 0) { try { process.kill(owner, 0); } catch (e) { if (e.code === "ESRCH") alive = false; } }
      else alive = Date.now() - (await stat(lock)).mtimeMs < 5 * 60 * 1000;
      if (alive) throw new UploadError("La subida está ocupada. Reintenta en unos segundos.", "UPLOAD_BUSY", 409);
      await rm(lock, { force: true });
      return this.lock(id, operation);
    }
    try { await handle.writeFile(String(process.pid)); return await operation(); }
    finally { await handle.close(); await rm(lock, { force: true }); }
  }
  async cleanup() {
    const root = path.join(this.root, "upload-sessions"); await mkdir(root, { recursive: true });
    for (const id of await readdir(root)) {
      if (!isProjectId(id)) continue;
      const directory = this.directory(id);
      const session = await readFile(path.join(directory, "session.json"), "utf8").then(JSON.parse).catch(() => null);
      if (!session || Date.parse(session.expiresAt) > Date.now()) continue;
      // Keep the capability and handoff record: completed jobs and phone
      // observers can outlive the receiving TTL. Originals are never cleaned.
      if (session.status === "QUEUED" || session.status === "ASSEMBLED") continue;
      if (session.status !== "RECEIVING") continue;
      try { const expired = await this.lock(id, async () => {
        const fresh = JSON.parse(await readFile(path.join(directory, "session.json"), "utf8"));
        if (Date.parse(fresh.expiresAt) <= Date.now() && fresh.status === "RECEIVING") {
          for (const name of await readdir(directory)) if (name !== "lock") await rm(path.join(directory, name), { force: true });
          return true;
        }
        return false;
      }); if (expired) await rm(directory, { recursive: true, force: true }); }
      catch (error) { if (error.code !== "UPLOAD_BUSY" && error.code !== "ENOENT") throw error; }
    }
  }
}

function digest(value) { return createHash("sha256").update(value).digest("hex"); }
function publicSession(session) { const result = { ...session }; delete result.tokenHash; delete result.relativePath; delete result.chunkHashes; return result; }
export async function hashFile(filename) { const hash = createHash("sha256"); for await (const chunk of createReadStream(filename)) hash.update(chunk); return hash.digest("hex"); }

