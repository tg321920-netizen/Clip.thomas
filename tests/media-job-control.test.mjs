import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JobStore } from "../services/JobStore.mjs";

async function isolated(operation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-media-control-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR; process.env.CLIPFORGE_STORAGE_DIR = root;
  try { await operation(new JobStore(), root); }
  finally { if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous; await rm(root, { recursive: true, force: true }); }
}

test("a late worker error cannot overwrite a user's cancellation", () => isolated(async store => {
  const queued = await store.enqueueMedia("MEDIA_STORY", randomUUID(), {});
  const claimed = await store.claimNext(["MEDIA_STORY"]);
  await store.transition(queued.id, "CANCELLED", "CANCELLED");
  await store.fail(claimed, new Error("encoder terminated after cancellation"), { retryable: false });
  assert.equal((await store.get(queued.id)).status, "CANCELLED");
}));

test("a corrupt job cannot hide valid history or stop the next healthy job", () => isolated(async (store, root) => {
  const good = await store.enqueueMedia("MEDIA_STORY", randomUUID(), {});
  const broken = await store.enqueueMedia("MEDIA_STORY", randomUUID(), {});
  await writeFile(path.join(root, "jobs", `${broken.id}.json`), "{interrupted write");
  assert.deepEqual((await store.listMedia()).map(job => job.id), [good.id]);
  const history = await store.listMediaWithIssues();
  assert.equal(history.issues.length, 1); assert.equal(history.issues[0].id, broken.id);
  assert.equal((await store.claimNext(["MEDIA_STORY"])).id, good.id);
  await store.release(good.id);
}));

test("resume waits for the old renderer to stop, and stale workers cannot overwrite the new attempt", () => isolated(async store => {
  const queued = await store.enqueueMedia("MEDIA_STORY", randomUUID(), { narration: "same source" });
  const old = await store.claimNext(["MEDIA_STORY"]);
  assert.equal((await store.cancelMedia(queued.id)).cancellationPending, true);
  await assert.rejects(store.enqueueMedia(old.type, old.projectId, old.payload), { code: "MEDIA_STOPPING" });
  assert.equal((await store.transition(old.id, "PROCESSING", "SCENES", 60)).status, "CANCELLED");
  await store.fail(old, new Error("terminated"), { retryable: false });
  assert.equal((await store.get(old.id)).cancellationPending, false);
  const resumed = await store.enqueueMedia(old.type, old.projectId, old.payload);
  assert.notEqual(resumed.generation, old.generation);
  const claimed = await store.claimNext(["MEDIA_STORY"]);
  await store.fail(old, new Error("obsolete completion"), { retryable: false });
  assert.equal((await store.get(old.id)).status, "PROCESSING");
  assert.equal(await store.claimNext(["MEDIA_STORY"]), null, "An obsolete attempt must not release the new lease");
  await store.cancelMedia(claimed.id); await store.fail(claimed, new Error("test finished"), { retryable: false });
}));

test("a cancelled completion cannot validate missing media or become READY", () => isolated(async store => {
  const queued = await store.enqueueMedia("MEDIA_STORY", randomUUID(), {});
  const claimed = await store.claimNext(["MEDIA_STORY"]);
  await store.cancelMedia(queued.id);
  const completed = await store.complete({ ...claimed, result: { relativePath: "absent.mp4", validation: { valid: true } } });
  assert.equal(completed.status, "CANCELLED");
}));

test("graceful interruption requeues the same job and keeps the request for recovery", () => isolated(async store => {
  const queued = await store.enqueueMedia("MEDIA_STORY", randomUUID(), { narrationAudio: "source.wav" });
  const claimed = await store.claimNext(["MEDIA_STORY"]);
  await store.interruptMedia(claimed);
  const resumed = await store.claimNext(["MEDIA_STORY"]);
  assert.equal(resumed.id, queued.id); assert.equal(resumed.attempts, 2);
  assert.deepEqual(resumed.payload, queued.payload);
  await store.release(resumed.id);
}));

test("simultaneous resume requests create a single attempt", () => isolated(async store => {
  const queued = await store.enqueueMedia("MEDIA_STORY", randomUUID(), {});
  await store.cancelMedia(queued.id);
  const results = await Promise.all(Array.from({ length: 5 }, () => store.enqueueMedia(queued.type, queued.projectId, queued.payload)));
  assert.equal(new Set(results.map(job => job.generation)).size, 1);
}));
