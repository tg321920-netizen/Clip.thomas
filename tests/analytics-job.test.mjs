import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JobStore, analyticsJobId } from "../services/JobStore.mjs";

const projectId = "11111111-1111-4111-8111-111111111111";
const publicationId = "22222222-2222-4222-8222-222222222222";

test("FETCH_ANALYTICS jobs are entity-scoped and idempotent while queued", async () => {
  await withStorage(async () => {
    const jobs = new JobStore();
    const first = await jobs.enqueueAnalytics(projectId, publicationId, {
      publicationId,
    });
    const second = await jobs.enqueueAnalytics(projectId, publicationId, {
      publicationId,
    });

    assert.equal(first.id, analyticsJobId(projectId, publicationId));
    assert.equal(second.id, first.id);
    assert.equal(second.status, "QUEUED");

    const claimed = await jobs.claimNext(["FETCH_ANALYTICS"]);
    assert.equal(claimed.id, first.id);
    assert.equal(claimed.type, "FETCH_ANALYTICS");
    assert.equal(claimed.entityId, publicationId);

    await jobs.complete(claimed);
    const completed = await jobs.getAnalyticsJob(projectId, publicationId);
    assert.equal(completed.status, "COMPLETED");

    const restarted = await jobs.enqueueAnalytics(
      projectId,
      publicationId,
      { publicationId },
      { restartCompleted: true },
    );
    assert.equal(restarted.status, "QUEUED");
    assert.equal(restarted.attempts, 0);
  });
});

async function withStorage(callback) {
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analytics-job-"));
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await callback(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}
