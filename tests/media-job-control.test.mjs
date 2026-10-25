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
