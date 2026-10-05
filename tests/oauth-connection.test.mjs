import assert from "node:assert/strict";
import test from "node:test";
import {
  OAuthConnectionService,
  buildAuthorizationUrl,
  createSignedOAuthState,
  getOAuthConfig,
  verifySignedOAuthState,
} from "../services/oauth/OAuthConnectionService.mjs";

const channelId = "11111111-1111-4111-8111-111111111111";
const secret = "oauth-state-secret-for-tests-only";
const now = Date.UTC(2026, 8, 24, 1, 45, 0);

test("OAuth state is signed, bound to channel/platform and expires", () => {
  const created = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  const verified = verifySignedOAuthState({
    state: created.state,
    cookieValue: created.cookieValue,
    secret,
    now: now + 30_000,
  });

  assert.equal(verified.channelId, channelId);
  assert.equal(verified.platform, "YOUTUBE");
  assert.equal(verified.state, created.state);

  assert.throws(
    () =>
      verifySignedOAuthState({
        state: `${created.state}tampered`,
        cookieValue: created.cookieValue,
        secret,
        now: now + 30_000,
      }),
    /state/i,
  );

  assert.throws(
    () =>
      verifySignedOAuthState({
        state: created.state,
        cookieValue: created.cookieValue,
        secret,
        now: now + 11 * 60 * 1000,
      }),
    /expired|state/i,
  );
});

test("provider authorization URLs contain callback, scopes and state", () => {
  const configs = {
    TIKTOK: {
      platform: "TIKTOK",
      clientId: "tt-key",
      clientSecret: "tt-secret",
      redirectUri: "https://clip.example/api/oauth/tiktok/callback",
      scopes: ["video.publish", "user.info.basic"],
      stateSecret: secret,
    },
    YOUTUBE: {
      platform: "YOUTUBE",
      clientId: "google-client",
      clientSecret: "google-secret",
      redirectUri: "https://clip.example/api/oauth/youtube/callback",
      scopes: ["https://www.googleapis.com/auth/youtube.upload"],
      stateSecret: secret,
    },
    FACEBOOK: {
      platform: "FACEBOOK",
      clientId: "meta-app",
      clientSecret: "meta-secret",
      redirectUri: "https://clip.example/api/oauth/facebook/callback",
      scopes: ["pages_show_list", "pages_manage_posts"],
      stateSecret: secret,
      graphVersion: "v24.0",
      graphBase: "https://graph.facebook.com",
    },
  };

  for (const [platform, config] of Object.entries(configs)) {
    const url = new URL(buildAuthorizationUrl(platform, config, "state-123"));
    assert.equal(url.searchParams.get("state"), "state-123");
    assert.equal(url.searchParams.get("redirect_uri"), config.redirectUri);
    assert.equal(url.searchParams.get("response_type"), "code");
  }

  const google = new URL(buildAuthorizationUrl("YOUTUBE", configs.YOUTUBE, "s"));
  assert.equal(google.searchParams.get("access_type"), "offline");
  assert.equal(google.searchParams.get("prompt"), "consent");
});

test("OAuth config rejects missing secrets and accepts explicit HTTPS callbacks", () => {
  assert.throws(
    () => getOAuthConfig("TIKTOK", {}),
    /CLIPFORGE_OAUTH_STATE_KEY|TIKTOK_CLIENT_KEY/i,
  );

  const config = getOAuthConfig("TIKTOK", {
    CLIPFORGE_OAUTH_STATE_KEY: secret,
    TIKTOK_CLIENT_KEY: "client-key-1234567890",
    TIKTOK_CLIENT_SECRET: "client-secret-1234567890",
    TIKTOK_REDIRECT_URI: "https://clip.example/api/oauth/tiktok/callback",
    TIKTOK_OAUTH_SCOPES: "video.publish user.info.basic",
  });

  assert.equal(config.clientId, "client-key-1234567890");
  assert.equal(config.redirectUri, "https://clip.example/api/oauth/tiktok/callback");
  assert.ok(config.scopes.includes("video.publish"));
});


function youtubeEnv(overrides = {}) {
  return {
    CLIPFORGE_OAUTH_STATE_KEY: secret,
    GOOGLE_CLIENT_ID: "google-client-id-for-tests",
    GOOGLE_CLIENT_SECRET: "google-client-secret-for-tests",
    GOOGLE_REDIRECT_URI: "https://clip.example/api/oauth/youtube/callback",
    GOOGLE_YOUTUBE_SCOPES:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    CLIPFORGE_AGENT_REAL_PUBLISHING: "false",
    ...overrides,
  };
}

test("YouTube OAuth uses only the upload and readonly scopes configured for ClipForge", () => {
  const config = getOAuthConfig("YOUTUBE", youtubeEnv());
  assert.deepEqual(config.scopes, [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
  ]);

  const url = new URL(buildAuthorizationUrl("YOUTUBE", config, "scope-state"));
  assert.equal(
    url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
  );
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
});


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function youtubeChannel() {
  return {
    id: channelId,
    platform: "YOUTUBE",
    oauthProfile: "DEFAULT",
    status: "DISCONNECTED",
    publishingEnabled: false,
    externalAccountId: null,
    externalAccountName: null,
  };
}

test("YouTube OAuth callback stores access/refresh tokens, connects the channel and never uploads", async () => {
  let channel = youtubeChannel();
  let stored = null;
  const requests = [];
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() { return channel; },
      async updateChannel(_id, input) {
        channel = { ...channel, ...input };
        return channel;
      },
    },
    vault: {
      isConfigured() { return true; },
      async get() { return null; },
      async set(id, value) {
        assert.equal(id, channelId);
        stored = value;
      },
    },
    now: () => now,
    fetchImpl: async (url, init = {}) => {
      const parsed = new URL(String(url));
      requests.push(parsed.toString());
      if (parsed.hostname === "oauth2.googleapis.com") {
        const form = new URLSearchParams(String(init.body || ""));
        assert.equal(form.get("grant_type"), "authorization_code");
        assert.equal(form.get("code"), "google-code");
        assert.equal(
          form.get("redirect_uri"),
          "https://clip.example/api/oauth/youtube/callback",
        );
        return jsonResponse({
          access_token: "youtube-access-token",
          refresh_token: "youtube-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope:
            "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        });
      }
      assert.equal(parsed.hostname, "www.googleapis.com");
      assert.equal(parsed.pathname, "/youtube/v3/channels");
      assert.equal(parsed.searchParams.get("mine"), "true");
      assert.equal(parsed.searchParams.get("part"), "id,snippet");
      return jsonResponse({
        items: [
          {
            id: "UC_clipforge_test",
            snippet: { title: "ClipForge Test Channel" },
          },
        ],
      });
    },
  });
  const signed = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  const result = await service.completeAuthorization(
    "YOUTUBE",
    {
      code: "google-code",
      state: signed.state,
      stateCookie: signed.cookieValue,
    },
    { env: youtubeEnv() },
  );

  assert.equal(result.status, "CONNECTED");
  assert.equal(result.externalAccountId, "UC_clipforge_test");
  assert.equal(result.externalAccountName, "ClipForge Test Channel");
  assert.equal(channel.status, "CONNECTED");
  assert.equal(channel.publishingEnabled, false);
  assert.equal(stored.accessToken, "youtube-access-token");
  assert.equal(stored.refreshToken, "youtube-refresh-token");
  assert.equal(stored.externalAccountId, "UC_clipforge_test");
  assert.equal(stored.externalAccountName, "ClipForge Test Channel");
  assert.equal(channel.externalAccountName, "ClipForge Test Channel");
  assert.equal(requests.length, 2);
  assert.equal(requests.some((value) => value.includes("/upload/youtube/")), false);
});

test("YouTube OAuth callback rejects an invalid state before network or storage", async () => {
  let networkCalls = 0;
  let writes = 0;
  const service = new OAuthConnectionService({
    channels: { async getChannel() { return youtubeChannel(); } },
    vault: {
      isConfigured() { return true; },
      async get() { return null; },
      async set() { writes += 1; },
    },
    now: () => now,
    fetchImpl: async () => {
      networkCalls += 1;
      throw new Error("network must not run");
    },
  });
  const signed = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  await assert.rejects(
    () =>
      service.completeAuthorization(
        "YOUTUBE",
        {
          code: "google-code",
          state: `${signed.state}-invalid`,
          stateCookie: signed.cookieValue,
        },
        { env: youtubeEnv() },
      ),
    /state mismatch/i,
  );
  assert.equal(networkCalls, 0);
  assert.equal(writes, 0);
});

test("YouTube OAuth requires a refresh token for a new durable connection", async () => {
  let writes = 0;
  let updates = 0;
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() { return youtubeChannel(); },
      async updateChannel() { updates += 1; },
    },
    vault: {
      isConfigured() { return true; },
      async get() { return null; },
      async set() { writes += 1; },
    },
    now: () => now,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "oauth2.googleapis.com") {
        return jsonResponse({
          access_token: "access-without-refresh",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return jsonResponse({ items: [{ id: "UC_without_refresh" }] });
    },
  });
  const signed = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  await assert.rejects(
    () =>
      service.completeAuthorization(
        "YOUTUBE",
        {
          code: "google-code",
          state: signed.state,
          stateCookie: signed.cookieValue,
        },
        { env: youtubeEnv() },
      ),
    /refresh token/i,
  );
  assert.equal(writes, 0);
  assert.equal(updates, 0);
});

test("YouTube OAuth automatically refreshes an expiring access token", async () => {
  let stored = {
    accessToken: "old-access",
    refreshToken: "stable-refresh",
    tokenType: "Bearer",
    scope:
      "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
    expiresAt: new Date(now - 1000).toISOString(),
    externalAccountId: "UC_refresh",
  };
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() {
        return { ...youtubeChannel(), status: "CONNECTED" };
      },
    },
    vault: {
      isConfigured() { return true; },
      async get() { return stored; },
      async set(_id, value) { stored = value; },
    },
    now: () => now,
    fetchImpl: async (url, init = {}) => {
      assert.equal(String(url), "https://oauth2.googleapis.com/token");
      const form = new URLSearchParams(String(init.body || ""));
      assert.equal(form.get("grant_type"), "refresh_token");
      assert.equal(form.get("refresh_token"), "stable-refresh");
      return jsonResponse({
        access_token: "new-access",
        expires_in: 3600,
        token_type: "Bearer",
      });
    },
  });

  const refreshed = await service.getValidCredentials(channelId, {
    env: youtubeEnv(),
  });
  assert.equal(refreshed.accessToken, "new-access");
  assert.equal(refreshed.refreshToken, "stable-refresh");
  assert.equal(refreshed.externalAccountId, "UC_refresh");
  assert.match(refreshed.scope, /youtube\.readonly/);
});

test("YouTube OAuth disconnect deletes local credentials and leaves publishing disabled", async () => {
  let channel = {
    ...youtubeChannel(),
    status: "CONNECTED",
    externalAccountId: "UC_disconnect",
    externalAccountName: "Disconnect Me",
  };
  let deleted = null;
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() { return channel; },
      async updateChannel(_id, input) {
        channel = { ...channel, ...input };
        return channel;
      },
    },
    vault: {
      isConfigured() { return true; },
      async delete(id) { deleted = id; },
    },
  });

  const disconnected = await service.disconnect(channelId);
  assert.equal(deleted, channelId);
  assert.equal(disconnected.status, "DISCONNECTED");
  assert.equal(disconnected.publishingEnabled, false);
  assert.equal(disconnected.externalAccountId, null);
  assert.equal(disconnected.externalAccountName, null);
});

test("YouTube OAuth start fails closed when Google credentials are missing", async () => {
  const service = new OAuthConnectionService({
    channels: { async getChannel() { return youtubeChannel(); } },
    vault: {},
  });
  await assert.rejects(
    () =>
      service.createAuthorization(channelId, "YOUTUBE", {
        env: { CLIPFORGE_OAUTH_STATE_KEY: secret },
      }),
    /GOOGLE_CLIENT_ID/i,
  );
});


test("YouTube OAuth reconnect preserves an existing refresh token for the same channel", async () => {
  let channel = youtubeChannel();
  let stored = {
    accessToken: "previous-access",
    refreshToken: "previous-refresh",
    expiresAt: new Date(now - 1000).toISOString(),
    externalAccountId: "UC_reconnected",
    externalAccountName: "Previous Channel",
  };
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() { return channel; },
      async updateChannel(_id, input) {
        channel = { ...channel, ...input };
        return channel;
      },
    },
    vault: {
      isConfigured() { return true; },
      async get() { return stored; },
      async set(_id, value) { stored = value; },
    },
    now: () => now,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "oauth2.googleapis.com") {
        return jsonResponse({
          access_token: "replacement-access",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return jsonResponse({
        items: [
          {
            id: "UC_reconnected",
            snippet: { title: "Reconnected Channel" },
          },
        ],
      });
    },
  });
  const signed = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  const result = await service.completeAuthorization(
    "YOUTUBE",
    {
      code: "google-code",
      state: signed.state,
      stateCookie: signed.cookieValue,
    },
    { env: youtubeEnv() },
  );

  assert.equal(result.status, "CONNECTED");
  assert.equal(stored.accessToken, "replacement-access");
  assert.equal(stored.refreshToken, "previous-refresh");
  assert.equal(stored.externalAccountId, "UC_reconnected");
  assert.equal(stored.externalAccountName, "Reconnected Channel");
});

for (const previousIdentity of ["UC_other_channel", null]) {
  test(`YouTube reconnect cannot inherit a refresh token from ${previousIdentity || "an unknown identity"}`, async () => {
    let writes = 0;
    const service = new OAuthConnectionService({
      channels: {
        async getChannel() { return youtubeChannel(); },
        async updateChannel() { writes += 1; },
      },
      vault: {
        isConfigured() { return true; },
        async get() {
          return { accessToken: "old-access", refreshToken: "old-refresh", externalAccountId: previousIdentity };
        },
        async set() { writes += 1; },
      },
      now: () => now,
      fetchImpl: async (url) => new URL(String(url)).hostname === "oauth2.googleapis.com"
        ? jsonResponse({ access_token: "new-access", expires_in: 3600 })
        : jsonResponse({ items: [{ id: "UC_new_channel" }] }),
    });
    const signed = createSignedOAuthState({ channelId, platform: "YOUTUBE", secret, now });
    await assert.rejects(() => service.completeAuthorization("YOUTUBE", {
      code: "code", state: signed.state, stateCookie: signed.cookieValue,
    }, { env: youtubeEnv() }), /refresh token/i);
    assert.equal(writes, 0, "Existing credentials and channel must remain intact");
  });
}

test("YouTube OAuth fails closed when the authorized Google account has no YouTube channel", async () => {
  let writes = 0;
  let updates = 0;
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() { return youtubeChannel(); },
      async updateChannel() { updates += 1; },
    },
    vault: {
      isConfigured() { return true; },
      async get() { return null; },
      async set() { writes += 1; },
    },
    now: () => now,
    fetchImpl: async (url) => {
      const parsed = new URL(String(url));
      if (parsed.hostname === "oauth2.googleapis.com") {
        return jsonResponse({
          access_token: "youtube-access-token",
          refresh_token: "youtube-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
        });
      }
      return jsonResponse({ items: [] });
    },
  });
  const signed = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  await assert.rejects(
    () =>
      service.completeAuthorization(
        "YOUTUBE",
        {
          code: "google-code",
          state: signed.state,
          stateCookie: signed.cookieValue,
        },
        { env: youtubeEnv() },
      ),
    /no youtube channel/i,
  );

  assert.equal(writes, 0);
  assert.equal(updates, 0);
});

test("YouTube OAuth propagates Google token errors without storing credentials", async () => {
  let writes = 0;
  let updates = 0;
  const service = new OAuthConnectionService({
    channels: {
      async getChannel() { return youtubeChannel(); },
      async updateChannel() { updates += 1; },
    },
    vault: {
      isConfigured() { return true; },
      async get() { return null; },
      async set() { writes += 1; },
    },
    now: () => now,
    fetchImpl: async () =>
      jsonResponse(
        {
          error: "invalid_grant",
          error_description: "Authorization code expired.",
        },
        400,
      ),
  });
  const signed = createSignedOAuthState({
    channelId,
    platform: "YOUTUBE",
    secret,
    now,
  });

  await assert.rejects(
    () =>
      service.completeAuthorization(
        "YOUTUBE",
        {
          code: "expired-code",
          state: signed.state,
          stateCookie: signed.cookieValue,
        },
        { env: youtubeEnv() },
      ),
    /authorization code expired/i,
  );

  assert.equal(writes, 0);
  assert.equal(updates, 0);
});


test("YouTube OAuth start fails closed when the credential vault is unavailable", async () => {
  const service = new OAuthConnectionService({
    channels: { async getChannel() { return youtubeChannel(); } },
    vault: { isConfigured() { return false; } },
  });

  await assert.rejects(
    () =>
      service.createAuthorization(channelId, "YOUTUBE", {
        env: youtubeEnv(),
      }),
    /credential vault|CLIPFORGE_CREDENTIALS_KEY/i,
  );
});
