import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResumableUploadStore, UPLOAD_CHUNK_BYTES } from "../services/ingest/ResumableUploadStore.mjs";
import { writeAll } from "../lib/write-all.mjs";
const hash = data => createHash("sha256").update(data).digest("hex");
async function fixture(t, size = 8) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-upload-")); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ResumableUploadStore({ root });
  const session = await store.create({ filename: "1000225709.mp4", mimeType: "video/mp4", size });
  return { root, store, session };
}
test("complete, reconstruct and finalize a multi-chunk file once", async t => {
  const data = Buffer.alloc(UPLOAD_CHUNK_BYTES + 33, 42);
  const { root, store, session: s } = await fixture(t, data.length);
  await store.putChunk(s.id, s.token, 1, [data.subarray(UPLOAD_CHUNK_BYTES)], hash(data.subarray(UPLOAD_CHUNK_BYTES)));
  await assert.rejects(store.finalize(s.id, s.token, async () => {}), { code: "CHUNKS_MISSING" });
  await store.putChunk(s.id, s.token, 0, [data.subarray(0, 11), data.subarray(11, UPLOAD_CHUNK_BYTES)], hash(data.subarray(0, UPLOAD_CHUNK_BYTES)));
  const status = await store.status(s.id, s.token); assert.equal(status.bytesReceived, data.length);
  let calls = 0, saved;
  const enqueue = async input => { calls++; saved = input; };
  await store.finalize(s.id, s.token, enqueue); await store.finalize(s.id, s.token, enqueue);
  assert.equal(calls, 1); assert.equal(saved.sha256, hash(data));
  assert.deepEqual(await readFile(path.join(root, saved.relativePath)), data);
  assert.equal((await store.status(s.id, s.token)).status, "QUEUED");
});
test("interrupted fragment is removed and reupload resumes existing fragments", async t => {
  const { store, session: s } = await fixture(t);
  const data = Buffer.from("abcdefgh");
  await assert.rejects(store.putChunk(s.id, s.token, 0, [data.subarray(0, 3)], hash(data)), { code: "CHUNK_INCOMPLETE" });
  assert.deepEqual((await store.status(s.id, s.token)).received, []);
  assert.equal((await readdir(store.directory(s.id))).some(n => n.endsWith(".part")), false);
  await store.putChunk(s.id, s.token, 0, [data], hash(data));
  assert.deepEqual((await new ResumableUploadStore({ root: store.root }).status(s.id, s.token)).received, [0]);
});
test("duplicate chunks are idempotent; changed duplicates are rejected", async t => {
  const { store, session: s } = await fixture(t); const data = Buffer.from("abcdefgh");
  await store.putChunk(s.id, s.token, 0, [data], hash(data));
  assert.equal((await store.putChunk(s.id, s.token, 0, [data], hash(data))).duplicate, true);
  await assert.rejects(store.putChunk(s.id, s.token, 0, [Buffer.from("12345678")], hash("12345678")), { code: "CHUNK_CONFLICT" });
});
test("authorization, index, size and integrity are checked", async t => {
  const { store, session: s } = await fixture(t); const data = Buffer.from("abcdefgh");
  await assert.rejects(store.status(s.id, "wrong"), { code: "UPLOAD_UNAUTHORIZED" });
  await assert.rejects(store.status("../../etc", s.token), { code: "UPLOAD_INVALID" });
  await assert.rejects(store.putChunk(s.id, s.token, -1, [data], hash(data)), { code: "CHUNK_INDEX_INVALID" });
  await assert.rejects(store.putChunk(s.id, s.token, 0, [Buffer.alloc(9)], hash(data)), { code: "CHUNK_SIZE_INVALID" });
  await assert.rejects(store.putChunk(s.id, s.token, 0, [data], hash("other")), { code: "CHUNK_HASH_MISMATCH" });
});
test("aborted chunk remains retryable", async t => {
  const { store, session: s } = await fixture(t); const abort = new AbortController(); abort.abort();
  const data = Buffer.from("abcdefgh");
  await assert.rejects(store.putChunk(s.id, s.token, 0, [data], hash(data), abort.signal), { code: "UPLOAD_INTERRUPTED" });
  await store.putChunk(s.id, s.token, 0, [data], hash(data));
});
test("live writer lock prevents concurrent mutation", async t => {
  const { store, session: s } = await fixture(t);
  await store.lock(s.id, async () => {
    await assert.rejects(store.lock(s.id, async () => {}), { code: "UPLOAD_BUSY" });
  });
});
test("expired incomplete uploads are cleaned without touching original files", async t => {
  const { root, store, session: s } = await fixture(t);
  await writeFile(path.join(root, "original.mp4"), "keep");
  const metadata = await store.load(s.id, s.token);
  await store.save({ ...metadata, expiresAt: "2000-01-01T00:00:00.000Z" });
  await store.cleanup(); assert.equal(await readFile(path.join(root, "original.mp4"), "utf8"), "keep");
  await assert.rejects(store.status(s.id, s.token), { code: "UPLOAD_NOT_FOUND" });
});
test("partial OS writes cannot silently truncate uploaded bytes", async () => {
  const result = []; const data = Buffer.from("abcdefgh");
  const handle = { write: async buffer => { result.push(buffer.subarray(0, 2)); return { bytesWritten: Math.min(2, buffer.length) }; } };
  assert.equal(await writeAll(handle, data), 8); assert.deepEqual(Buffer.concat(result), data);
  await assert.rejects(writeAll({ write: async () => ({ bytesWritten: 0 }) }, data));
});
