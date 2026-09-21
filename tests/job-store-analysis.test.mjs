import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore } from "../services/JobStore.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

test("analysis worker claims only analysis jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analysis-jobs-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const store = new JobStore();

    await store.enqueueTranscription(PROJECT_ID);
    const analysis = await store.enqueueAnalysis(PROJECT_ID, {
      minDuration: 15,
      maxDuration: 60,
    });

    const claimed = await store.claimNext(["ANALYZE_VIDEO"]);

    assert.equal(claimed?.id, analysis.id);
    assert.equal(claimed?.type, "ANALYZE_VIDEO");
    assert.equal(claimed?.payload?.minDuration, 15);

    await store.complete(claimed);

    const transcription = await store.getTranscriptionJob(PROJECT_ID);
    assert.equal(transcription?.status, "QUEUED");
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;

    await rm(root, { recursive: true, force: true });
  }
});
