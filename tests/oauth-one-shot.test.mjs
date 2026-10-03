import test from "node:test";
import assert from "node:assert/strict";
import { buildAuthorizationUrl } from "../services/oauth/OAuthConnectionService.mjs";

test("smart one-shot YouTube OAuth reuses an existing grant without forcing consent", () => {
  const url = new URL(
    buildAuthorizationUrl(
      "YOUTUBE",
      {
        clientId: "client.apps.googleusercontent.com",
        redirectUri: "https://example.test/api/oauth/youtube/callback",
        scopes: [
          "https://www.googleapis.com/auth/youtube.upload",
          "https://www.googleapis.com/auth/youtube.readonly",
        ],
        allowAccessTokenOnly: true,
      },
      "state-1",
    ),
  );

  assert.equal(url.searchParams.get("prompt"), null);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("include_granted_scopes"), "true");
});

test("normal YouTube OAuth still forces consent so a refresh token can be issued", () => {
  const url = new URL(
    buildAuthorizationUrl(
      "YOUTUBE",
      {
        clientId: "client.apps.googleusercontent.com",
        redirectUri: "https://example.test/api/oauth/youtube/callback",
        scopes: ["https://www.googleapis.com/auth/youtube.upload"],
        allowAccessTokenOnly: false,
      },
      "state-2",
    ),
  );

  assert.equal(url.searchParams.get("prompt"), "consent");
});
