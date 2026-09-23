import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore } from "../services/JobStore.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

test("News worker claims only RENDER_NEWS jobs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-news-jobs-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const store = new JobStore();
    await store.enqueueAnalysis(PROJECT_ID);
    const news = await store.enqueueNewsRender(PROJECT_ID);

    const claimed = await store.claimNext(["RENDER_NEWS"]);
    assert.equal(claimed?.id, news.id);
    assert.equal(claimed?.type, "RENDER_NEWS");

    const progress = await store.updateProgress(claimed.id, 54);
    assert.equal(progress?.progress, 54);

    await store.complete(claimed);

    const analysis = await store.getAnalysisJob(PROJECT_ID);
    assert.equal(analysis?.status, "QUEUED");
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;

    await rm(root, { recursive: true, force: true });
  }
});
