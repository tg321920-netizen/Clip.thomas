import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { isRetryableIngestError } from "../lib/ingest-error-policy.mjs";
test("permanent import errors store retryable=false and stay FAILED", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-url-terminal-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    const store = new IngestJobStore();
    const job = await store.create({ url: "https://example.org/movie.mp4", mode: "IMPORT" });
    const claimed = await store.claimNext();
    assert.equal(claimed.id, job.id);
    const failed = await store.fail(claimed, new Error("HTTP Error 404: Not Found"), { retryable: false });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.retryable, false);
    assert.equal(failed.nextAttemptAt, null);
    assert.equal((await store.get(job.id)).retryable, false);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an offline Kick channel completes as FAILED on the first attempt without waiting", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-kick-offline-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    const store = new IngestJobStore();
    const job = await store.create({ url: "https://kick.com/westcol", mode: "IMPORT" });
    const claimed = await store.claimNext();
    assert.equal(claimed.id, job.id);
    const error = new Error("ERROR: [kick:live] westcol: The channel is not currently live");
    const failed = await store.fail(claimed, error, { retryable: isRetryableIngestError(error) });
    assert.equal(failed.status, "FAILED");
    assert.equal(failed.stage, "FAILED");
    assert.equal(failed.retryable, false);
    assert.equal(failed.nextAttemptAt, null);
    assert.equal(await store.claimNext(), null);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
