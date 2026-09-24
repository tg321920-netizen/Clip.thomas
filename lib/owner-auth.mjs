export const OWNER_SESSION_COOKIE = "clipforge_owner_session";
export const OWNER_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

export function getOwnerAuthConfig(env = process.env) {
  const accessKey = String(env.CLIPFORGE_OWNER_ACCESS_KEY || "").trim();
  const sessionKey = String(env.CLIPFORGE_SESSION_KEY || "").trim();
  const hasAny = Boolean(accessKey || sessionKey);
  const configured = accessKey.length >= 16 && sessionKey.length >= 32;

  return {
    configured,
    hasAny,
    accessKey,
    sessionKey,
  };
}

export function shouldRequireOwnerAuth(env = process.env) {
  if (
    String(env.CLIPFORGE_REQUIRE_OWNER_AUTH || "")
      .trim()
      .toLowerCase() === "true"
  ) {
    return true;
  }
  return Boolean(String(env.VERCEL_ENV || "").trim());
}

/**
 * @param {{ sessionKey?: string, now?: number, maxAgeSeconds?: number }} [options]
 */
export async function createOwnerSessionToken(options = {}) {
  const {
    sessionKey = "",
    now = Date.now(),
    maxAgeSeconds = OWNER_SESSION_MAX_AGE_SECONDS,
  } = options;

  requireSessionKey(sessionKey);
  const maxAge = Number(maxAgeSeconds);
  if (!Number.isFinite(maxAge) || maxAge < 60 || maxAge > 30 * 24 * 60 * 60) {
    throw new Error("Owner session max age is invalid.");
  }

  const payload = {
    v: 1,
    exp: Math.floor(now / 1000) + Math.floor(maxAge),
  };
  const encoded = base64UrlEncode(
    new TextEncoder().encode(JSON.stringify(payload)),
  );
  const signature = await sign(encoded, sessionKey);
  return `${encoded}.${signature}`;
}

/**
 * @param {unknown} token
 * @param {{ sessionKey?: string, now?: number }} [options]
 */
export async function verifyOwnerSessionToken(token, options = {}) {
  const { sessionKey = "", now = Date.now() } = options;
  requireSessionKey(sessionKey);
  const raw = String(token || "").trim();
  const [encoded, signature, ...rest] = raw.split(".");
  if (!encoded || !signature || rest.length > 0) return false;

  const expected = await sign(encoded, sessionKey);
  if (!constantTimeTextEqual(signature, expected)) return false;

  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(base64UrlDecode(encoded)));
  } catch {
    return false;
  }

  if (payload?.v !== 1 || !Number.isFinite(payload?.exp)) return false;
  return payload.exp >= Math.floor(now / 1000);
}

export function constantTimeTextEqual(left, right) {
  const a = String(left ?? "");
  const b = String(right ?? "");
  const length = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}

async function sign(value, sessionKey) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(sessionKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return base64UrlEncode(new Uint8Array(signature));
}

function requireSessionKey(value) {
  if (String(value || "").trim().length < 32) {
    throw new Error("CLIPFORGE_SESSION_KEY must contain at least 32 characters.");
  }
}

function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const normalized = String(value).replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
