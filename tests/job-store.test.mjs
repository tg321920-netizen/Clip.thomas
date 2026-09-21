import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore } from "../services/JobStore.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

test("transcription jobs are idempotent and claimable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-jobs-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const store = new JobStore({ maxAttempts: 3 });
    const first = await store.enqueueTranscription(PROJECT_ID);
    const second = await store.enqueueTranscription(PROJECT_ID);

    assert.equal(first.id, second.id);
    assert.equal(second.status, "QUEUED");

    const claimed = await store.claimNext();
    assert.equal(claimed?.id, first.id);
    assert.equal(claimed?.status, "PROCESSING");
    assert.equal(claimed?.attempts, 1);

    const completed = await store.complete(claimed);
    assert.equal(completed.status, "COMPLETED");

    const duplicate = await store.enqueueTranscription(PROJECT_ID);
    assert.equal(duplicate.status, "COMPLETED");
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;

    await rm(root, { recursive: true, force: true });
  }
});
