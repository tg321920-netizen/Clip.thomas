import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";

test("ingest jobs persist, retry and recover an interrupted worker without infinite attempts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-ingest-store-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const firstStore = new IngestJobStore({ maxAttempts: 2, staleAfterMs: 5 });
    const created = await firstStore.create({
      url: "https://example.com/video.mp4",
      mode: "IMPORT",
    });

    assert.equal(created.status, "QUEUED");
    assert.equal(created.stage, "QUEUED");

    const claimed = await firstStore.claimNext();
    assert.equal(claimed.id, created.id);
    assert.equal(claimed.status, "PROCESSING");
    assert.equal(claimed.attempts, 1);

    await firstStore.updateProgress(claimed.id, 47, "DOWNLOADING");

    const secondStore = new IngestJobStore({ maxAttempts: 2, staleAfterMs: 5 });
    const persisted = await secondStore.get(created.id);
    assert.equal(persisted.progress, 47);
    assert.equal(persisted.stage, "DOWNLOADING");

    const lockPath = path.join(root, "ingest-jobs", `${created.id}.lock`);
    const old = new Date(Date.now() - 1000);
    await utimes(lockPath, old, old);

    const recovered = await secondStore.claimNext();
    assert.equal(recovered.id, created.id);
    assert.equal(recovered.status, "PROCESSING");
    assert.equal(recovered.attempts, 2);
    assert.equal(recovered.progress, 47);

    const terminal = await secondStore.fail(recovered, new Error("synthetic failure"));
    assert.equal(terminal.status, "FAILED");
    assert.equal(terminal.attempts, 2);
    assert.equal(terminal.nextAttemptAt, null);

    const manualRetry = await secondStore.retry(created.id);
    assert.equal(manualRetry.status, "QUEUED");
    assert.equal(manualRetry.attempts, 0);
    assert.equal(manualRetry.progress, 0);
    assert.equal(manualRetry.error, null);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
