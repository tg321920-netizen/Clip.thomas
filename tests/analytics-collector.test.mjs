import assert from "node:assert/strict";
import test from "node:test";
import {
  AnalyticsCollectorService,
  normalizeProviderMetrics,
} from "../services/analytics/AnalyticsCollectorService.mjs";

const ids = {
  publication: "11111111-1111-4111-8111-111111111111",
  project: "22222222-2222-4222-8222-222222222222",
  clip: "33333333-3333-4333-8333-333333333333",
  channel: "44444444-4444-4444-8444-444444444444",
};

const publication = {
  id: ids.publication,
  projectId: ids.project,
  clipId: ids.clip,
  channelId: ids.channel,
  platform: "YOUTUBE",
  status: "PUBLISHED",
  externalPostId: "youtube-123",
};

const channel = {
  id: ids.channel,
  platform: "YOUTUBE",
  status: "CONNECTED",
  publishingEnabled: true,
};

test("AnalyticsCollectorService stores only normalized provider metrics", async () => {
  let recorded = null;
  const collector = new AnalyticsCollectorService({
    publications: {
      async get(id) {
        return id === ids.publication ? publication : null;
      },
    },
    channels: {
      async getChannel(id) {
        return id === ids.channel ? channel : null;
      },
    },
    credentials: {
      isConfigured() {
        return true;
      },
      async get() {
        return { accessToken: "token" };
      },
    },
    analytics: {
      async recordSnapshot(input) {
        recorded = input;
        return { id: "snapshot", ...input };
      },
    },
    providerFactory() {
      return {
        async getAnalytics() {
          return {
            views: "1234",
            likes: 50,
            comments: 4,
            shares: -10,
            unknownMetric: 999,
            source: "youtube-data-api",
          };
        },
      };
    },
  });

  const result = await collector.collectPublication(ids.publication);
  assert.equal(result.collected, true);
  assert.deepEqual(recorded.metrics, {
    views: 1234,
    likes: 50,
    comments: 4,
  });
  assert.equal(recorded.source, "youtube-data-api");
});

test("AnalyticsCollectorService skips providers that do not expose analytics", async () => {
  const collector = new AnalyticsCollectorService({
    publications: {
      async get() {
        return publication;
      },
    },
    channels: {
      async getChannel() {
        return channel;
      },
    },
    credentials: {
      isConfigured() {
        return true;
      },
    },
    analytics: {},
    providerFactory() {
      return {};
    },
  });

  const result = await collector.collectPublication(ids.publication);
  assert.equal(result.collected, false);
  assert.equal(result.reason, "PROVIDER_ANALYTICS_UNSUPPORTED");
});

test("normalizeProviderMetrics never invents unsupported metrics", () => {
  assert.deepEqual(
    normalizeProviderMetrics({
      views: 10,
      likes: "2",
      shares: null,
      madeUpScore: 100,
    }),
    { views: 10, likes: 2, shares: 0 },
  );
});
