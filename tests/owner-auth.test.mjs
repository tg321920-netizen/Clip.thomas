import assert from "node:assert/strict";
import test from "node:test";
import {
  constantTimeTextEqual,
  createOwnerSessionToken,
  getOwnerAuthConfig,
  shouldRequireOwnerAuth,
  shouldTrustPlatformAuth,
  verifyOwnerSessionToken,
} from "../lib/owner-auth.mjs";

const sessionKey = "owner-session-secret-1234567890-abcdef";

test("owner auth config requires sufficiently strong server secrets", () => {
  assert.deepEqual(getOwnerAuthConfig({}), {
    configured: false,
    hasAny: false,
    accessKey: "",
    sessionKey: "",
  });

  const configured = getOwnerAuthConfig({
    CLIPFORGE_OWNER_ACCESS_KEY: "owner-access-key-123456",
    CLIPFORGE_SESSION_KEY: sessionKey,
  });
  assert.equal(configured.configured, true);
  assert.equal(configured.hasAny, true);
});

test("hosted deployments require owner auth while local dev can opt in", () => {
  assert.equal(shouldRequireOwnerAuth({}), false);
  assert.equal(shouldRequireOwnerAuth({ VERCEL_ENV: "preview" }), true);
  assert.equal(
    shouldRequireOwnerAuth({ CLIPFORGE_REQUIRE_OWNER_AUTH: "true" }),
    true,
  );
});

test("trusted platform auth is explicit, Vercel-only and can be overridden", () => {
  assert.equal(shouldTrustPlatformAuth({}), false);
  assert.equal(
    shouldTrustPlatformAuth({ CLIPFORGE_TRUST_PLATFORM_AUTH: "true" }),
    false,
  );
  assert.equal(
    shouldTrustPlatformAuth({
      VERCEL_ENV: "production",
      CLIPFORGE_TRUST_PLATFORM_AUTH: "true",
    }),
    true,
  );
  assert.equal(
    shouldRequireOwnerAuth({
      VERCEL_ENV: "production",
      CLIPFORGE_TRUST_PLATFORM_AUTH: "true",
    }),
    false,
  );
  assert.equal(
    shouldRequireOwnerAuth({
      VERCEL_ENV: "production",
      CLIPFORGE_TRUST_PLATFORM_AUTH: "true",
      CLIPFORGE_REQUIRE_OWNER_AUTH: "true",
    }),
    true,
  );
});

test("signed owner session validates, expires and rejects tampering", async () => {
  const now = Date.UTC(2026, 8, 24, 3, 0, 0);
  const token = await createOwnerSessionToken({
    sessionKey,
    now,
    maxAgeSeconds: 600,
  });

  assert.equal(
    await verifyOwnerSessionToken(token, {
      sessionKey,
      now: now + 599_000,
    }),
    true,
  );
  assert.equal(
    await verifyOwnerSessionToken(token, {
      sessionKey,
      now: now + 601_000,
    }),
    false,
  );

  const [payload, signature] = token.split(".");
  assert.equal(
    await verifyOwnerSessionToken(`${payload}.${signature}x`, {
      sessionKey,
      now,
    }),
    false,
  );
});

test("owner secret comparison is exact", () => {
  assert.equal(constantTimeTextEqual("abc", "abc"), true);
  assert.equal(constantTimeTextEqual("abc", "abd"), false);
  assert.equal(constantTimeTextEqual("abc", "ab"), false);
});
