import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ResumableUploadStore, UPLOAD_CHUNK_BYTES, hashFile } from "../services/ingest/ResumableUploadStore.mjs";
const digest = value => createHash("sha256").update(value).digest("hex");
async function fixture(t, size = 8) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ResumableUploadStore({ root });
  const session = await store.create({ filename: "byte-integrity-test.mp4", mimeType: "video/mp4", size });
  return { root, store, session };
}
test("73.9 MB transfer resumes and reconstructs exact bytes with requests below 10 MB", async t => {
  // Opaque bytes test transport only. This is neither a video nor media quality evidence.
  const size = 73_900_000;
  const { root, session: s, store: first } = await fixture(t, size);
  let store = first; const expected = createHash("sha256");
  for (let index = 0; index < s.chunkCount; index++) {
    const chunk = Buffer.alloc(Math.min(UPLOAD_CHUNK_BYTES, size - index * UPLOAD_CHUNK_BYTES), index);
    expected.update(chunk); assert.ok(chunk.length < 10_000_000);
    if (index === 17) {
      await assert.rejects(store.putChunk(s.id, s.token, index, [chunk.subarray(0, 97)], digest(chunk)), { code: "CHUNK_INCOMPLETE" });
      store = new ResumableUploadStore({ root });
      assert.equal((await store.status(s.id, s.token)).received.length, 17);
    }
    await store.putChunk(s.id, s.token, index, [chunk], digest(chunk));
    if (index === 0) assert.equal((await store.putChunk(s.id, s.token, index, [chunk], digest(chunk))).duplicate, true);
  }
  let input, calls = 0;
  const enqueue = async value => { input = value; calls++; };
  await store.finalize(s.id, s.token, enqueue);
  await store.finalize(s.id, s.token, enqueue);
  assert.equal(calls, 1);
  assert.equal((await stat(path.join(root, input.relativePath))).size, size);
  assert.equal(await hashFile(path.join(root, input.relativePath)), expected.digest("hex"));
  assert.equal((await store.status(s.id, s.token)).bytesReceived, size);
  assert.equal(Object.keys((await store.status(s.id, s.token)).receivedHashes).length, s.chunkCount);
});
test("interrupted handoff resumes without replacing the assembled original", async t => {
  const { root, store, session: s } = await fixture(t);
  const data = Buffer.from("abcdefgh");
  await store.putChunk(s.id, s.token, 0, [data], digest(data));
  let queued;
  await assert.rejects(store.finalize(s.id, s.token, async input => { queued = input; throw new Error("crash after queue write"); }));
  assert.equal((await store.status(s.id, s.token)).status, "ASSEMBLED");
  const source = path.join(root, queued.relativePath); const before = await stat(source);
  await new ResumableUploadStore({ root }).finalize(s.id, s.token, async input => assert.deepEqual(input, queued));
  const after = await stat(source);
  assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(source), data);
});
test("disk damage can be repaired only with the originally committed chunk hash", async t => {
  const { store, session: s } = await fixture(t); const data = Buffer.from("abcdefgh");
  await store.putChunk(s.id, s.token, 0, [data], digest(data));
  await writeFile(path.join(store.directory(s.id), "chunk-0"), "damaged!");
  await assert.rejects(store.finalize(s.id, s.token, async () => {}), { code: "UPLOAD_INTEGRITY_FAILED" });
  await store.putChunk(s.id, s.token, 0, [data], digest(data));
  await store.finalize(s.id, s.token, async () => {});
});
test("cleanup cannot remove a session renewed after its expiration scan", async t => {
  const { store, session: s } = await fixture(t);
  const expired = { ...(await store.load(s.id, s.token)), expiresAt: "2000-01-01T00:00:00.000Z" };
  await store.save(expired);
  const lock = store.lock.bind(store);
  store.lock = async (id, operation) => {
    await store.save({ ...expired, expiresAt: new Date(Date.now() + 60_000).toISOString() });
    return lock(id, operation);
  };
  await store.cleanup(); assert.equal((await store.status(s.id, s.token)).status, "RECEIVING");
});
test("queued handoff and original remain available after receiving TTL", async t => {
  const { root, store, session: s } = await fixture(t); const data = Buffer.from("abcdefgh"); let input;
  await store.putChunk(s.id, s.token, 0, [data], digest(data));
  await store.finalize(s.id, s.token, async value => { input = value; });
  await store.save({ ...(await store.load(s.id, s.token)), expiresAt: "2000-01-01T00:00:00.000Z" });
  await store.cleanup(); assert.equal((await store.status(s.id, s.token)).status, "QUEUED");
  assert.deepEqual(await readFile(path.join(root, input.relativePath)), data);
});
