import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore } from "../services/JobStore.mjs";
import { AnalyticsCollectorService } from "../services/analytics/AnalyticsCollectorService.mjs";
import { AnalyticsService } from "../services/analytics/AnalyticsService.mjs";
import { YouTubeProvider } from "../services/publishing/YouTubeProvider.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const PUBLICATION_ID = "9f3d14d5-69f7-4acb-b687-f2b50fbf4d79";
const CHANNEL_ID = "0f99f199-192d-4900-95c6-dbbb60130ee8";

test("AnalyticsCollector persists only metrics returned by a supported provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-collector-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const analytics = new AnalyticsService();
    const collector = new AnalyticsCollectorService({
      analytics,
      publications: {
        async get(id) {
          assert.equal(id, PUBLICATION_ID);
          return {
            id,
            status: "PUBLISHED",
            platform: "YOUTUBE",
            channelId: CHANNEL_ID,
            externalPostId: "video-123",
          };
        },
      },
      channels: {
        async getChannel(id) {
          assert.equal(id, CHANNEL_ID);
          return { id, platform: "YOUTUBE" };
        },
      },
      credentials: {
        async get(id) {
          assert.equal(id, CHANNEL_ID);
          return { accessToken: "token" };
        },
      },
      providerFactory(platform) {
        assert.equal(platform, "YOUTUBE");
        return {
          async getAnalytics(context) {
            assert.equal(context.externalPostId, "video-123");
            return {
              provider: "test-provider",
              metrics: { views: 500, likes: 25, comments: 4 },
            };
          },
        };
      },
    });

    const result = await collector.collect(PUBLICATION_ID, {
      capturedAt: "2030-01-01T12:00:00.000Z",
    });

    assert.equal(result.supported, true);
    assert.equal(result.snapshot.metrics.views, 500);
    assert.equal(result.snapshot.metrics.shares, null);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("YouTube getAnalytics normalizes counters and leaves unavailable metrics null", async () => {
  const provider = new YouTubeProvider({
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          items: [
            {
              id: "video-123",
              statistics: {
                viewCount: "1500",
                likeCount: "75",
                commentCount: "11",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  const result = await provider.getAnalytics({
    credentials: { accessToken: "token" },
    externalPostId: "video-123",
  });

  assert.equal(result.metrics.views, 1500);
  assert.equal(result.metrics.likes, 75);
  assert.equal(result.metrics.comments, 11);
  assert.equal(result.metrics.shares, null);
  assert.equal(result.metrics.watchTimeSeconds, null);
});

test("FETCH_ANALYTICS jobs are idempotent per publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-analytics-job-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    const jobs = new JobStore();
    const first = await jobs.enqueueAnalytics(PROJECT_ID, PUBLICATION_ID);
    const duplicate = await jobs.enqueueAnalytics(PROJECT_ID, PUBLICATION_ID);
    assert.equal(first.id, duplicate.id);
    assert.equal(first.type, "FETCH_ANALYTICS");

    const claimed = await jobs.claimNext(["FETCH_ANALYTICS"]);
    assert.equal(claimed.entityId, PUBLICATION_ID);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
