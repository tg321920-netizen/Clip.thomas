import assert from "node:assert/strict";
import test from "node:test";
import { PerformanceAnalyzer } from "../services/analytics/PerformanceAnalyzer.mjs";

test("PerformanceAnalyzer derives rates without inventing missing metrics", () => {
  const analyzer = new PerformanceAnalyzer();
  const result = analyzer.analyze({
    views: 1000,
    likes: 80,
    comments: 10,
    shares: 15,
    saves: 10,
    followersGained: 8,
    averageWatchSeconds: 24,
    durationSeconds: 30,
  });

  assert.equal(result.metrics.completionRate, 0.8);
  assert.equal(result.metrics.engagementRate, 0.115);
  assert.equal(result.metrics.shareRate, 0.015);
  assert.equal(result.metrics.saveRate, 0.01);
  assert.equal(result.metrics.followerConversionRate, 0.008);
  assert.ok(result.score >= 0 && result.score <= 100);
  assert.ok(result.signals.includes("HIGH_RETENTION"));
  assert.ok(result.signals.includes("HIGH_ENGAGEMENT"));
});

test("PerformanceAnalyzer treats absent optional counters as zero", () => {
  const result = new PerformanceAnalyzer().analyze({ views: 0 });
  assert.equal(result.score, 0);
  assert.deepEqual(result.signals, ["NO_STRONG_SIGNAL"]);
});

test("PerformanceAnalyzer rejects invalid negative metrics", () => {
  assert.throws(
    () => new PerformanceAnalyzer().analyze({ views: -1 }),
    /views must be a non-negative finite number/,
  );
});

test("PerformanceAnalyzer ranks stronger samples first", () => {
  const analyzer = new PerformanceAnalyzer();
  const ranked = analyzer.rank([
    { id: "weak", views: 1000, likes: 5, averageWatchSeconds: 5, durationSeconds: 30 },
    { id: "strong", views: 1000, likes: 120, shares: 20, saves: 15, followersGained: 10, averageWatchSeconds: 27, durationSeconds: 30 },
  ]);

  assert.equal(ranked[0].sample.id, "strong");
  assert.ok(ranked[0].analysis.score > ranked[1].analysis.score);
});

// Keep this test provider-independent: platform adapters will supply these raw metrics later.
