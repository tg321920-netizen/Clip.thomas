import test from "node:test";
import assert from "node:assert/strict";
import { stripTypeScriptTypes } from "node:module";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { createUploadHandlers } from "../services/ingest/ResumableUploadHandlers.mjs";
import { ResumableUploadStore, hashFile } from "../services/ingest/ResumableUploadStore.mjs";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";

async function setup(t, storageAvailable = true) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-client-"));
  const previous = { fetch: globalThis.fetch, localStorage: Object.getOwnPropertyDescriptor(globalThis, "localStorage"), root: process.env.CLIPFORGE_STORAGE_DIR };
  process.env.CLIPFORGE_STORAGE_DIR = root;
  const cache = new Map();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem(key) { if (!storageAvailable) throw new Error("Storage disabled"); return cache.get(key) || null; },
    setItem(key, value) { if (!storageAvailable) throw new Error("Storage disabled"); cache.set(key, value); },
    removeItem(key) { if (!storageAvailable) throw new Error("Storage disabled"); cache.delete(key); },
  } });
  t.after(async () => {
    globalThis.fetch = previous.fetch;
    if (previous.localStorage) Object.defineProperty(globalThis, "localStorage", previous.localStorage); else delete globalThis.localStorage;
    if (previous.root === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous.root;
    await rm(root, { recursive: true, force: true });
  });
  const jobs = new IngestJobStore(); const handlers = createUploadHandlers({ uploads: new ResumableUploadStore({ root }), jobs });
  const uploaded = []; let pauseAfter = null; let activeController; let queuedId;
  globalThis.fetch = async (url, init) => {
    if (init.signal.aborted) throw new DOMException("Paused", "AbortError");
    const req = new Request(`https://clipforge.test${url}`, init);
    const parts = new URL(req.url).pathname.split("/");
    let response;
    if (parts.length === 4) response = await handlers.create(req);
    else if (parts.length === 7) {
      assert.equal(init.method, "PUT"); assert.ok(init.body.size <= 2 * 1024 * 1024);
      response = await handlers.chunk(req, parts[4], parts[6]); uploaded.push(Number(parts[6]));
      if (pauseAfter === uploaded.length) activeController.abort();
    } else response = req.method === "GET" ? await handlers.status(req, parts[4]) : await handlers.finalize(req, parts[4]);
    return response;
  };
  // Execute the actual browser helper after erasing types; no implementation copy.
  const source = await readFile(new URL("../lib/resumable-upload-client.ts", import.meta.url), "utf8");
  const js = stripTypeScriptTypes(source, { mode: "transform" });
  const { uploadResumable } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${randomUUID()}`);
  return { root, jobs, uploaded, async run(file, pause = null) {
    pauseAfter = pause; activeController = new AbortController(); const progress = [];
    await assert.rejects(uploadResumable(file, {
      signal: activeController.signal, onProgress: (percent, stage) => progress.push({ percent, stage }),
      onQueued: id => { queuedId = id; activeController.abort(); },
    }), error => error.name === "AbortError");
    return { progress, queuedId };
  }, uploadResumable };
}

test("browser helper and real handlers resume >10 MB with localStorage disabled", async t => {
  const env = await setup(t, false);
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 17, 7);
  const file = new File([bytes], "authorized-transport-only.mp4", { type: "video/mp4", lastModified: 100 });
  const paused = await env.run(file, 2);
  assert.ok(paused.progress.every(p => p.percent < 100));
  const resumed = await env.run(file);
  assert.deepEqual(env.uploaded, [0, 1, 2, 3, 4, 5, 6]);
  assert.equal((await env.jobs.list()).length, 1);
  const job = await env.jobs.get(resumed.queuedId);
  assert.equal(await hashFile(path.join(env.root, job.source.relativePath)), createHash("sha256").update(bytes).digest("hex"));
  assert.equal(resumed.progress.at(-1).percent, 100);
  // These opaque bytes never stand in for an MP4, FFprobe or Android acceptance.
});

test("sampled filename fingerprint cannot splice a changed middle into a retained upload", async t => {
  const env = await setup(t);
  const bytes = Buffer.alloc(12 * 1024 * 1024 + 17, 8);
  const original = new File([bytes], "transport-only.mp4", { type: "video/mp4", lastModified: 200 });
  await env.run(original, 2);
  const changed = Buffer.from(bytes); changed[2 * 1024 * 1024 + 100] = 9;
  const replacement = new File([changed], original.name, { type: original.type, lastModified: original.lastModified });
  await assert.rejects(env.uploadResumable(replacement, { signal: new AbortController().signal, onProgress() {}, onQueued() {} }), /no coincide/);
  assert.deepEqual(env.uploaded, [0, 1]); assert.equal((await env.jobs.list()).length, 0);
});
