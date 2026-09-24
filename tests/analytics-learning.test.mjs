import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AnalyticsRepository } from "../services/analytics/AnalyticsRepository.mjs";
import { AnalyticsService } from "../services/analytics/AnalyticsService.mjs";
import { PerformanceAnalyzer } from "../services/analytics/PerformanceAnalyzer.mjs";
import { AIUsageService } from "../services/usage/AIUsageService.mjs";

const ids = {
  project: "11111111-1111-4111-8111-111111111111",
  clipA: "22222222-2222-4222-8222-222222222222",
  clipB: "33333333-3333-4333-8333-333333333333",
  clipC: "44444444-4444-4444-8444-444444444444",
  clipD: "55555555-5555-4555-8555-555555555555",
  channel: "66666666-6666-4666-8666-666666666666",
  pubA: "77777777-7777-4777-8777-777777777777",
  pubB: "88888888-8888-4888-8888-888888888888",
  pubC: "99999999-9999-4999-8999-999999999999",
  pubD: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

test("AnalyticsService stores normalized real snapshots and summarizes latest publication data", async () => {
  await withStorage(async () => {
    const publications = fakePublications([
      publication(ids.pubA, ids.clipA),
      publication(ids.pubB, ids.clipB),
    ]);
    const service = new AnalyticsService({
      publications,
      repository: new AnalyticsRepository(),
    });

    await service.recordSnapshot({
      publicationId: ids.pubA,
      metrics: { views: 100, likes: 10, comments: 2, shares: 3 },
    });
    await service.recordSnapshot({
      publicationId: ids.pubB,
      metrics: { views: 50, likes: 4, comments: 1, shares: 1 },
    });

    const summary = await service.summarize();
    assert.equal(summary.publishedCount, 2);
    assert.equal(summary.measuredCount, 2);
    assert.equal(summary.totals.views, 150);
    assert.equal(summary.totals.likes, 14);
    assert.equal(summary.engagementRate, 21 / 150);
    assert.equal(summary.coverage, 1);

    await assert.rejects(
      () =>
        service.recordSnapshot({
          publicationId: ids.pubA,
          metrics: { views: -1 },
        }),
      /non-negative/,
    );
  });
});

test("PerformanceAnalyzer produces evidence without silently changing strategy", async () => {
  await withStorage(async (root) => {
    await mkdir(path.join(root, "projects"), { recursive: true });
    await writeFile(
      path.join(root, "projects", `${ids.project}.json`),
      JSON.stringify({
        id: ids.project,
        clips: [
          clip(ids.clipA, 20, "VIRAL"),
          clip(ids.clipB, 22, "VIRAL"),
          clip(ids.clipC, 55, "CLEAN"),
          clip(ids.clipD, 58, "CLEAN"),
        ],
      }),
      "utf8",
    );

    const publications = [
      publication(ids.pubA, ids.clipA),
      publication(ids.pubB, ids.clipB),
      publication(ids.pubC, ids.clipC),
      publication(ids.pubD, ids.clipD),
    ];
    const snapshots = new Map([
      [ids.pubA, snapshot(ids.pubA, 1000, 100)],
      [ids.pubB, snapshot(ids.pubB, 1200, 120)],
      [ids.pubC, snapshot(ids.pubC, 300, 25)],
      [ids.pubD, snapshot(ids.pubD, 350, 30)],
    ]);

    const analyzer = new PerformanceAnalyzer({
      publications: fakePublications(publications),
      analytics: { latest: async (publicationId) => snapshots.get(publicationId) || null },
    });

    const report = await analyzer.analyze();
    assert.equal(report.publicationCount, 4);
    assert.equal(report.measuredCount, 4);
    assert.ok(report.recommendations.some((item) => item.type === "DURATION_EVIDENCE"));
    assert.ok(report.recommendations.some((item) => item.type === "SUBTITLE_STYLE_EVIDENCE"));
    assert.equal(Object.hasOwn(report, "strategyChanges"), false);
  });
});

test("AIUsageService records tokens and never invents model pricing", async () => {
  await withStorage(async () => {
    const usage = new AIUsageService();
    await usage.record({
      provider: "openai",
      model: "example-model",
      operation: "auto-edit",
      inputTokens: 100,
      outputTokens: 50,
      projectId: ids.project,
    });
    await usage.record({
      provider: "openai",
      model: "example-model",
      operation: "analysis",
      inputTokens: 200,
      outputTokens: 75,
      estimatedCostUsd: 0.01,
      projectId: ids.project,
    });

    const summary = await usage.summarize({ projectId: ids.project });
    assert.equal(summary.records, 2);
    assert.equal(summary.totalTokens, 425);
    assert.equal(summary.estimatedCostUsd, 0.01);
    assert.equal(summary.costedRecords, 1);
    assert.equal(summary.costCoverage, 0.5);
    assert.match(summary.note, /no inventa precios/i);
  });
});

function fakePublications(records) {
  return {
    async get(id) {
      return records.find((record) => record.id === id) || null;
    },
    async list(filters = {}) {
      return records.filter((record) => {
        if (filters.status && record.status !== filters.status) return false;
        if (filters.projectId && record.projectId !== filters.projectId) return false;
        if (filters.channelId && record.channelId !== filters.channelId) return false;
        if (filters.platform && record.platform !== filters.platform) return false;
        return true;
      });
    },
  };
}

function publication(id, clipId) {
  return {
    id,
    projectId: ids.project,
    clipId,
    channelId: ids.channel,
    platform: "YOUTUBE",
    status: "PUBLISHED",
    createdAt: new Date().toISOString(),
  };
}

function clip(id, duration, style) {
  return {
    id,
    duration,
    status: "READY",
    subtitles: { style },
  };
}

function snapshot(publicationId, views, likes) {
  return {
    id: crypto.randomUUID(),
    publicationId,
    platform: "YOUTUBE",
    metrics: { views, likes, comments: 0, shares: 0, saves: 0 },
    capturedAt: new Date().toISOString(),
  };
}

async function withStorage(callback) {
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analytics-"));
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await callback(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}
