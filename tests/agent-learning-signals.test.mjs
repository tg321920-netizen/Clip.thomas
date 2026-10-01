import test from "node:test";
import assert from "node:assert/strict";
import { PerformanceAnalyzer } from "../services/analytics/PerformanceAnalyzer.mjs";

function publication(index, hour) {
  return {
    id: `pub-${index}`,
    projectId: `00000000-0000-4000-8000-00000000000${index}`,
    clipId: `10000000-0000-4000-8000-00000000000${index}`,
    channelId: "20000000-0000-4000-8000-000000000000",
    platform: index < 3 ? "YOUTUBE" : "TIKTOK",
    status: "PUBLISHED",
    publishedAt: `2026-09-20T${String(hour).padStart(2, "0")}:00:00.000Z`,
  };
}

test("performance learning exposes conservative relative signals only with enough evidence", async () => {
  const publications = Array.from({ length: 6 }, (_, index) => publication(index, index < 3 ? 18 : 8));
  const analyzer = new PerformanceAnalyzer({
    publications: {
      async list() {
        return publications;
      },
    },
    analytics: {
      async latest(publicationId) {
        const index = Number(publicationId.split("-")[1]);
        return {
          metrics: {
            views: index < 3 ? 1200 + index * 50 : 300 + index * 10,
            likes: index < 3 ? 120 : 20,
            averageWatchTimeSeconds: index < 3 ? 20 : 6,
            impressions: 2000,
            clicks: index < 3 ? 160 : 20,
          },
          capturedAt: "2026-09-21T00:00:00.000Z",
        };
      },
    },
    channels: {
      async getChannel() {
        return { timezone: "UTC" };
      },
    },
  });

  const originalLoad = process.env.CLIPFORGE_STORAGE_DIR;
  try {
    // Missing project files are allowed: the analyzer still has platform/hour evidence.
    const report = await analyzer.analyze();
    assert.equal(report.measuredCount, 6);
    assert.ok(report.byPlatform.every((group) => Object.hasOwn(group, "relativeViewIndex")));
    assert.ok(report.byPublishHour.some((group) => group.key === "18:00"));
    assert.ok(report.signals.some((signal) => signal.type === "PUBLISH_HOUR_PERFORMANCE_SIGNAL"));
    assert.match(report.signals[0].note, /do not change strategy automatically/i);
  } finally {
    if (originalLoad === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = originalLoad;
  }
});
