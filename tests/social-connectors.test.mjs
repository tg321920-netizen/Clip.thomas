import test from "node:test";
import assert from "node:assert/strict";
import { PublishingProviderError } from "../services/publishing/PublishingProvider.mjs";
import {
  PlatformConnector,
  normalizeConnectorError,
} from "../services/publishing/connectors/PlatformConnector.mjs";
import { SocialPublishingRouter } from "../services/publishing/connectors/SocialPublishingRouter.mjs";

const CHANNEL_ID = "0f99f199-192d-4900-95c6-dbbb60130ee8";

function channel(platform) {
  return {
    id: CHANNEL_ID,
    name: `${platform} channel`,
    platform,
    status: "CONNECTED",
    publishingEnabled: true,
    externalAccountId: "remote-account",
  };
}

function connectorOptions(platform, credentials) {
  return {
    channels: {
      async getChannel() {
        return channel(platform);
      },
    },
    credentials: {
      isConfigured() {
        return true;
      },
      async get() {
        return credentials;
      },
    },
    oauth: {},
    publishing: {},
    analytics: {},
    providerFactory() {
      return {
        requirements() {
          return { oauthScopes: ["example.scope"] };
        },
        async publish() {},
        async getStatus() {},
        ...(platform === "YOUTUBE" ? { async getAnalytics() {} } : {}),
      };
    },
  };
}

test("social connectors expose status without leaking OAuth tokens", async () => {
  const connector = new PlatformConnector(
    "YOUTUBE",
    connectorOptions("YOUTUBE", {
      accessToken: "secret-access-token",
      refreshToken: "secret-refresh-token",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }),
  );
  const status = await connector.getStatus(CHANNEL_ID);
  assert.equal(status.platform, "YOUTUBE");
  assert.equal(status.connected, true);
  assert.equal(status.publishingEnabled, true);
  assert.equal(status.oauth.state, "VALID");
  assert.equal(status.capabilities.analytics, true);
  assert.equal(status.publishingReady, true);
  assert.equal(JSON.stringify(status).includes("secret-access-token"), false);
});

test("expired renewable OAuth is represented as REFRESHABLE", async () => {
  const connector = new PlatformConnector(
    "TIKTOK",
    connectorOptions("TIKTOK", {
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: "2020-01-01T00:00:00.000Z",
    }),
  );
  const status = await connector.getStatus(CHANNEL_ID);
  assert.equal(status.oauth.state, "REFRESHABLE");
  assert.equal(status.oauth.refreshAvailable, true);
  assert.equal(status.publishingReady, true);
});

test("router registers TikTok, Facebook and YouTube as first-class connectors", () => {
  const fakeChannels = { async listChannels() { return []; } };
  const fakePublications = {};
  const fakeScheduler = {};
  const stub = (platform) => ({ platform });
  const router = new SocialPublishingRouter({
    channels: fakeChannels,
    publications: fakePublications,
    scheduler: fakeScheduler,
    tiktok: stub("TIKTOK"),
    facebook: stub("FACEBOOK"),
    youtube: stub("YOUTUBE"),
  });

  assert.equal(router.connectorFor("TIKTOK").platform, "TIKTOK");
  assert.equal(router.connectorFor("FACEBOOK").platform, "FACEBOOK");
  assert.equal(router.connectorFor("YOUTUBE").platform, "YOUTUBE");
});

test("router blocks real publishing while the agent publishing flag is OFF", async () => {
  const previous = process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
  delete process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
  try {
    const router = new SocialPublishingRouter({
      channels: { async listChannels() { return []; } },
      publications: {},
      scheduler: {},
      tiktok: { platform: "TIKTOK" },
      facebook: { platform: "FACEBOOK" },
      youtube: { platform: "YOUTUBE" },
    });
    await assert.rejects(
      () => router.publishPublication("publication-id", { allowRealPublishing: true }),
      (error) => error?.code === "AGENT_REAL_PUBLISHING_OFF",
    );
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
    else process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = previous;
  }
});

test("connector errors normalize rate limits for bounded retry logic", () => {
  const error = new PublishingProviderError("Too many requests", {
    code: "YOUTUBE_HTTP_429",
    retryable: true,
  });
  const normalized = normalizeConnectorError(error, "YOUTUBE");
  assert.equal(normalized.retryable, true);
  assert.equal(normalized.rateLimited, true);
  assert.equal(normalized.platform, "YOUTUBE");
});
