import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JobStore } from "../services/JobStore.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

test("render jobs are isolated by clip id and persist real progress", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-render-jobs-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const store = new JobStore();
    const clipA = randomUUID();
    const clipB = randomUUID();

    const first = await store.enqueueRender(PROJECT_ID, clipA);
    const second = await store.enqueueRender(PROJECT_ID, clipB);

    assert.notEqual(first.id, second.id);

    const claimed = await store.claimNext(["RENDER_CLIP"]);
    assert.equal(claimed?.type, "RENDER_CLIP");
    assert.ok(claimed?.entityId === clipA || claimed?.entityId === clipB);

    const progress = await store.updateProgress(claimed.id, 47);
    assert.equal(progress?.progress, 47);

    const completed = await store.complete({
      ...claimed,
      progress: 47,
    });
    assert.equal(completed.status, "COMPLETED");
    assert.equal(completed.progress, 100);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;

    await rm(root, { recursive: true, force: true });
  }
});
