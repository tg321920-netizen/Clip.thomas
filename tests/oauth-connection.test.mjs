import assert from "node:assert/strict";
import test from "node:test";
import {
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
