import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnalyticsService } from "../services/analytics/AnalyticsService.mjs";

const PUBLICATION_ID = "9f3d14d5-69f7-4acb-b687-f2b50fbf4d79";

test("AnalyticsService preserves unavailable metrics as null instead of inventing zero", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analytics-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const service = new AnalyticsService();
    const record = await service.record({
      publicationId: PUBLICATION_ID,
      platform: "YOUTUBE",
      provider: "youtube-data-api",
      metrics: {
        views: 1200,
        likes: 80,
        comments: 12,
      },
      capturedAt: "2030-01-01T12:00:00.000Z",
    });

    assert.equal(record.metrics.views, 1200);
    assert.equal(record.metrics.likes, 80);
    assert.equal(record.metrics.shares, null);
    assert.equal(record.metrics.watchTimeSeconds, null);

    const latest = await service.latest(PUBLICATION_ID);
    assert.equal(latest.id, record.id);
    assert.equal(latest.provider, "youtube-data-api");
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("AnalyticsService validates ids, negative metrics and retention bounds", async () => {
  const service = new AnalyticsService();

  await assert.rejects(
    () =>
      service.record({
        publicationId: "../bad",
        platform: "YOUTUBE",
        metrics: { views: 1 },
      }),
    /invalid publicationId/i,
  );

  await assert.rejects(
    () =>
      service.record({
        publicationId: PUBLICATION_ID,
        platform: "YOUTUBE",
        metrics: { views: -1 },
      }),
    /invalid analytics metric/i,
  );

  await assert.rejects(
    () =>
      service.record({
        publicationId: PUBLICATION_ID,
        platform: "YOUTUBE",
        metrics: { retentionPercent: 101 },
      }),
    /retentionPercent/i,
  );
});
