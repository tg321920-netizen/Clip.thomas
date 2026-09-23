import test from "node:test";
import assert from "node:assert/strict";
import {
  buildObservations,
  buildRecommendations,
} from "../services/learning/PerformanceAnalyzer.mjs";

function row(overrides = {}) {
  return {
    views: 100,
    likes: 10,
    comments: 2,
    shares: 1,
    retentionPercent: null,
    duration: 30,
    viralScore: 70,
    subtitleStyle: "VIRAL",
    framingMode: "FILL",
    localHour: 15,
    ...overrides,
  };
}

test("PerformanceAnalyzer refuses to overfit fewer than three samples", () => {
  const rows = [row(), row({ views: 200 })];
  const observations = buildObservations(rows);
  const recommendations = buildRecommendations(rows, observations);

  assert.equal(recommendations.length, 1);
  assert.equal(recommendations[0].id, "MORE_DATA");
  assert.equal(recommendations[0].autoApply, false);
});

test("PerformanceAnalyzer produces a controlled recommendation only with comparable evidence", () => {
  const rows = [
    row({ duration: 15, views: 100 }),
    row({ duration: 18, views: 120 }),
    row({ duration: 30, views: 300 }),
    row({ duration: 35, views: 340 }),
  ];
  const observations = buildObservations(rows);
  const recommendations = buildRecommendations(rows, observations);

  const duration = recommendations.find((item) => item.type === "DURATION");
  assert.ok(duration);
  assert.equal(duration.evidence.group, "20-40s");
  assert.equal(duration.evidence.sampleCount, 2);
  assert.equal(duration.autoApply, false);
});

test("observations keep engagement calculation separate from views", () => {
  const observations = buildObservations([
    row({ duration: 30, views: 100, likes: 10, comments: 5, shares: 5 }),
  ]);

  assert.equal(observations.duration[0].averageViews, 100);
  assert.equal(observations.duration[0].averageEngagementRate, 20);
});
