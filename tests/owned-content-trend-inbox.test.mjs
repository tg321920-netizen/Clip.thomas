import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TrendHunterService } from "../services/owned-content/TrendHunterService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-trend-inbox-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("Trend Hunter keeps a signal unselected until an explicit human selection", async () => {
  await withStorage(async () => {
    const trends = new TrendHunterService();
    const channelId = crypto.randomUUID();
    const trend = await trends.ingest({
      channelId,
      topic: "Fast-growing technology story",
      category: "TECH",
      sourceCount: 4,
      growthScore: 90,
      saturationScore: 10,
      originalityPotential: 80,
      historyFitScore: 60,
      relevanceScore: 90,
    }, {
      niche: "technology news and verified trends",
      targetAudience: "technology audience",
    });

    assert.equal(trend.state, "VIRAL");
    assert.equal(trend.requiresHumanSelection, true);
    assert.equal(trend.selectedAt, null);

    const before = await trends.list({ channelId });
    assert.equal(before.length, 1);
    assert.equal(before[0].id, trend.id);
    assert.equal(before[0].selectedAt, null);

    const selected = await trends.select(trend.id);
    assert.ok(selected.selectedAt);

    const viral = await trends.list({ channelId, state: "VIRAL" });
    assert.equal(viral.length, 1);
    assert.equal(viral[0].selectedAt, selected.selectedAt);
  });
});
