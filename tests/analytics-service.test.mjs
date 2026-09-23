import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AnalyticsService } from "../services/analytics/AnalyticsService.mjs";

test("AnalyticsService persists snapshots and returns the latest one", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analytics-"));
  const previous = process.env.CLIPFORGE_STORAGE_ROOT;
  process.env.CLIPFORGE_STORAGE_ROOT = root;
  try {
    const service = new AnalyticsService();
    await service.record({ publicationId: "pub_1", platform: "youtube", capturedAt: "2026-09-23T10:00:00Z", metrics: { views: 10, likes: 2, retention: 55 } });
    await service.record({ publicationId: "pub_1", platform: "YOUTUBE", capturedAt: "2026-09-23T11:00:00Z", metrics: { views: 25, likes: 5, comments: 1, shares: 2, watchTime: 300, retention: 61, followersGained: 3 } });
    const rows = await service.list({ publicationId: "pub_1" });
    assert.equal(rows.length, 2);
    assert.equal(rows[0].metrics.views, 10);
    assert.equal((await service.latest("pub_1")).metrics.views, 25);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_ROOT; else process.env.CLIPFORGE_STORAGE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("AnalyticsService rejects impossible retention", async () => {
  const service = new AnalyticsService();
  await assert.rejects(() => service.record({ publicationId: "pub_2", platform: "TIKTOK", metrics: { retention: 101 } }), /Retention/);
});
