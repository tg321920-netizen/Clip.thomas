import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createUploadHandlers } from "../services/ingest/ResumableUploadHandlers.mjs";
import { ResumableUploadStore, hashFile } from "../services/ingest/ResumableUploadStore.mjs";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { ingestUrlJob } from "../services/ingest/UrlIngestService.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const request = (method, body, headers = {}) => new Request("https://clipforge.test/api/videos/uploads", { method, headers, ...(body === undefined ? {} : { body }) });

test("actual upload handlers accept 73.9 MB, resume, queue once and reject non-media in the worker", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-route-")); const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(async () => { if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous; await rm(root, { recursive: true, force: true }); });
  const jobs = new IngestJobStore();
  let handlers = createUploadHandlers({ uploads: new ResumableUploadStore({ root }), jobs });
  const size = 73_900_000;
  // Opaque bytes prove request handling/integrity, never playable MP4 quality.
  const response = await handlers.create(request("POST", JSON.stringify({ filename: "transport-only.mp4", mimeType: "video/mp4", size }), { "Content-Type": "application/json" }));
  assert.equal(response.status, 201);
  const { session } = await response.json(); const token = { "X-Upload-Token": session.token };
  assert.equal((await handlers.status(request("GET", undefined, { "X-Upload-Token": "bad" }), session.id)).status, 403);
  const expected = createHash("sha256");
  for (let index = 0; index < session.chunkCount; index++) {
    const bytes = Buffer.alloc(Math.min(session.chunkSize, size - index * session.chunkSize), index); expected.update(bytes);
    const headers = { ...token, "Content-Type": "application/octet-stream", "X-Chunk-SHA256": sha(bytes) }; assert.ok(bytes.length < 10_000_000);
    if (index === 12) {
      assert.equal((await handlers.chunk(request("PUT", bytes.subarray(0, 40), headers), session.id, String(index))).status, 409);
      handlers = createUploadHandlers({ uploads: new ResumableUploadStore({ root }), jobs });
      assert.equal((await (await handlers.status(request("GET", undefined, token), session.id)).json()).session.received.length, 12);
    }
    assert.equal((await handlers.chunk(request("PUT", bytes, headers), session.id, String(index))).status, 200);
    if (index === 0) assert.equal((await (await handlers.chunk(request("PUT", bytes, headers), session.id, "0")).json()).duplicate, true);
  }
  assert.equal((await handlers.finalize(request("POST", undefined, token), session.id)).status, 202);
  assert.equal((await handlers.finalize(request("POST", undefined, token), session.id)).status, 202);
  const queued = await (await handlers.status(request("GET", undefined, token), session.id)).json();
  assert.equal(queued.session.bytesReceived, size); assert.equal(queued.job.type, "INGEST_UPLOAD"); assert.equal((await jobs.list()).length, 1);
  const original = path.join(root, queued.job.source.relativePath);
  assert.equal((await stat(original)).size, size); assert.equal(await hashFile(original), expected.digest("hex"));
  // Actual FFprobe must reject the opaque fixture before any poster/render runs.
  await assert.rejects(ingestUrlJob(queued.job)); assert.equal(await loadProjectFile(session.id), null);
  assert.equal((await stat(original)).size, size, "Failed validation must preserve the original");
});
test("session creation bounds streamed JSON without Content-Length", async () => {
  const response = await createUploadHandlers().create(request("POST", JSON.stringify({ padding: "a".repeat(5000) }), { "Content-Type": "application/json" }));
  assert.equal(response.status, 400); assert.match((await response.json()).error, /grande/);
});
