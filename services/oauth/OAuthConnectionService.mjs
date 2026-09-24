import {
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { CredentialVault } from "../security/CredentialVault.mjs";

const PLATFORMS = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const STATE_TTL_SECONDS = 10 * 60;

export class OAuthConnectionService {
  constructor(options = {}) {
    this.channels = options.channels || new ChannelService();
    this.vault = options.vault || new CredentialVault();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.now = options.now || (() => Date.now());
  }

  async createAuthorization(channelId, platform, options = {}) {
    assertId(channelId, "channel");
    const normalized = normalizePlatform(platform);
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");
    if (channel.platform !== normalized) {
      throw new Error("OAuth platform must match the channel platform.");
    }

    const config = getOAuthConfig(normalized, options.env || process.env);
    const stateBundle = createSignedOAuthState({
      channelId,
      platform: normalized,
      secret: config.stateSecret,
      now: this.now(),
    });

    return {
      platform: normalized,
      channel,
      authorizationUrl: buildAuthorizationUrl(normalized, config, stateBundle.state),
      state: stateBundle.state,
      stateCookie: stateBundle.cookieValue,
      cookieMaxAge: STATE_TTL_SECONDS,
    };
  }

  async completeAuthorization(platform, input = {}, options = {}) {
    const normalized = normalizePlatform(platform);
    const config = getOAuthConfig(normalized, options.env || process.env);
    const state = verifySignedOAuthState({
      state: input.state,
      cookieValue: input.stateCookie,
      secret: config.stateSecret,
      now: this.now(),
    });

    if (state.platform !== normalized) {
      throw new Error("OAuth callback platform does not match the authorization request.");
    }

    const channel = await this.channels.getChannel(state.channelId);
    if (!channel) throw new Error("Channel not found.");
    if (channel.platform !== normalized) {
      throw new Error("OAuth channel platform changed during authorization.");
    }

    const code = cleanRequired(input.code, "authorization code", 4096);
    const token = await this.#exchangeCode(normalized, code, config);
    const credentials = normalizeCredentials(normalized, token, this.now());

    if (normalized === "FACEBOOK") {
      const pages = await this.#fetchFacebookPages(credentials.accessToken, config);
      if (pages.length === 1) {
        const selected = pageCredentials(credentials, pages[0]);
        await this.vault.set(channel.id, selected);
        await this.channels.updateChannel(channel.id, {
          status: "CONNECTED",
          publishingEnabled: false,
          externalAccountId: pages[0].id,
        });
        return {
          channelId: channel.id,
          platform: normalized,
          status: "CONNECTED",
          externalAccountId: pages[0].id,
          pageSelectionRequired: false,
        };
      }

      await this.vault.set(channel.id, {
        ...credentials,
        userAccessToken: credentials.accessToken,
        accessToken: credentials.accessToken,
        pageId: null,
      });
      await this.channels.updateChannel(channel.id, {
        status: "DISCONNECTED",
        publishingEnabled: false,
        externalAccountId: null,
      });

      return {
        channelId: channel.id,
        platform: normalized,
        status: "PAGE_SELECTION_REQUIRED",
        externalAccountId: null,
        pageSelectionRequired: true,
        pageCount: pages.length,
      };
    }

    await this.vault.set(channel.id, credentials);
    await this.channels.updateChannel(channel.id, {
      status: "CONNECTED",
      publishingEnabled: false,
      externalAccountId: credentials.externalAccountId || null,
    });

    return {
      channelId: channel.id,
      platform: normalized,
      status: "CONNECTED",
      externalAccountId: credentials.externalAccountId || null,
      pageSelectionRequired: false,
    };
  }

  async getConnectionStatus(channelId) {
    assertId(channelId, "channel");
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    if (this.vault.isConfigured?.() !== true) {
      return {
        channel,
        vaultConfigured: false,
        credentialsConfigured: false,
        pageSelectionRequired: false,
      };
    }

    const credentials = await this.vault.get(channelId);
    return {
      channel,
      vaultConfigured: true,
      credentialsConfigured: Boolean(credentials?.accessToken),
      pageSelectionRequired:
        channel.platform === "FACEBOOK" &&
        Boolean(credentials?.userAccessToken || credentials?.accessToken) &&
        !credentials?.pageId,
    };
  }

  async listFacebookPages(channelId, options = {}) {
    assertId(channelId, "channel");
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");
    if (channel.platform !== "FACEBOOK") {
      throw new Error("Page selection is only available for Facebook channels.");
    }

    const credentials = await this.vault.get(channelId);
    const userAccessToken =
      credentials?.userAccessToken ||
      (credentials?.pageId ? null : credentials?.accessToken);
    if (!userAccessToken) {
      throw new Error("Reconnect Facebook before selecting a Page.");
    }

    const config = getOAuthConfig("FACEBOOK", options.env || process.env);
    const pages = await this.#fetchFacebookPages(userAccessToken, config);
    return pages.map((page) => ({ id: page.id, name: page.name }));
  }

  async selectFacebookPage(channelId, pageId, options = {}) {
    assertId(channelId, "channel");
    const selectedId = cleanRequired(pageId, "Facebook Page id", 180);
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");
    if (channel.platform !== "FACEBOOK") {
      throw new Error("Page selection is only available for Facebook channels.");
    }

    const credentials = await this.vault.get(channelId);
    const userAccessToken =
      credentials?.userAccessToken ||
      (credentials?.pageId ? null : credentials?.accessToken);
    if (!userAccessToken) {
      throw new Error("Reconnect Facebook before selecting a Page.");
    }

    const config = getOAuthConfig("FACEBOOK", options.env || process.env);
    const pages = await this.#fetchFacebookPages(userAccessToken, config);
    const page = pages.find((entry) => entry.id === selectedId);
    if (!page) throw new Error("The selected Facebook Page is not authorized.");

    await this.vault.set(channelId, pageCredentials(credentials, page));
    const updated = await this.channels.updateChannel(channelId, {
      status: "CONNECTED",
      publishingEnabled: false,
      externalAccountId: page.id,
    });

    return {
      channel: updated,
      page: { id: page.id, name: page.name },
    };
  }

  async disconnect(channelId) {
    assertId(channelId, "channel");
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    if (this.vault.isConfigured?.() === true) {
      await this.vault.delete(channelId);
    }
    const updated = await this.channels.updateChannel(channelId, {
      status: "DISCONNECTED",
      publishingEnabled: false,
      externalAccountId: null,
    });
    return updated;
  }

  async getValidCredentials(channelId, options = {}) {
    assertId(channelId, "channel");
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    let credentials = await this.vault.get(channelId);
    if (!credentials?.accessToken) return null;

    const expiresAt = Date.parse(credentials.expiresAt || "");
    const refreshSoon = Number.isFinite(expiresAt) && expiresAt - this.now() <= 5 * 60 * 1000;
    if (!refreshSoon) return credentials;

    if (!credentials.refreshToken) return credentials;
    if (!["TIKTOK", "YOUTUBE"].includes(channel.platform)) return credentials;

    const config = getOAuthConfig(channel.platform, options.env || process.env);
    const refreshed = await this.#refresh(channel.platform, credentials, config);
    credentials = {
      ...credentials,
      ...normalizeCredentials(channel.platform, refreshed, this.now(), credentials),
    };
    await this.vault.set(channelId, credentials);
    return credentials;
  }

  async #exchangeCode(platform, code, config) {
    if (platform === "TIKTOK") {
      return postForm(this.fetchImpl, "https://open.tiktokapis.com/v2/oauth/token/", {
        client_key: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }, "TikTok");
    }

    if (platform === "YOUTUBE") {
      const token = await postForm(this.fetchImpl, "https://oauth2.googleapis.com/token", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: config.redirectUri,
      }, "Google");

      const externalAccountId = await fetchYouTubeChannelId(
        this.fetchImpl,
        token.access_token,
      );
      return { ...token, externalAccountId };
    }

    const url = new URL(`${config.graphBase}/${config.graphVersion}/oauth/access_token`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("client_secret", config.clientSecret);
    url.searchParams.set("redirect_uri", config.redirectUri);
    url.searchParams.set("code", code);
    return fetchJson(this.fetchImpl, url, { method: "GET" }, "Facebook");
  }

  async #refresh(platform, credentials, config) {
    if (platform === "TIKTOK") {
      return postForm(this.fetchImpl, "https://open.tiktokapis.com/v2/oauth/token/", {
        client_key: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }, "TikTok");
    }

    if (platform === "YOUTUBE") {
      return postForm(this.fetchImpl, "https://oauth2.googleapis.com/token", {
        client_id: config.clientId,
        client_secret: config.clientSecret,
        grant_type: "refresh_token",
        refresh_token: credentials.refreshToken,
      }, "Google");
    }

    return credentials;
  }

  async #fetchFacebookPages(userAccessToken, config) {
    const url = new URL(`${config.graphBase}/${config.graphVersion}/me/accounts`);
    url.searchParams.set("fields", "id,name,access_token");
    const body = await fetchJson(
      this.fetchImpl,
      url,
      { headers: { Authorization: `Bearer ${userAccessToken}` } },
      "Facebook",
    );

    return (Array.isArray(body?.data) ? body.data : [])
      .filter(
        (page) =>
          typeof page?.id === "string" &&
          page.id &&
          typeof page?.access_token === "string" &&
          page.access_token,
      )
      .map((page) => ({
        id: page.id,
        name: String(page.name || "Facebook Page").slice(0, 160),
        accessToken: page.access_token,
      }));
  }
}

export function getOAuthConfig(platform, env = process.env) {
  const normalized = normalizePlatform(platform);
  const stateSecret = cleanSecret(env.CLIPFORGE_OAUTH_STATE_KEY, "CLIPFORGE_OAUTH_STATE_KEY");

  if (normalized === "TIKTOK") {
    return {
      platform: normalized,
      clientId: cleanSecret(env.TIKTOK_CLIENT_KEY, "TIKTOK_CLIENT_KEY"),
      clientSecret: cleanSecret(env.TIKTOK_CLIENT_SECRET, "TIKTOK_CLIENT_SECRET"),
      redirectUri: requireHttpsUrl(env.TIKTOK_REDIRECT_URI, "TIKTOK_REDIRECT_URI"),
      scopes: normalizeScopes(env.TIKTOK_OAUTH_SCOPES || "video.publish"),
      stateSecret,
    };
  }

  if (normalized === "YOUTUBE") {
    return {
      platform: normalized,
      clientId: cleanSecret(env.GOOGLE_CLIENT_ID, "GOOGLE_CLIENT_ID"),
      clientSecret: cleanSecret(env.GOOGLE_CLIENT_SECRET, "GOOGLE_CLIENT_SECRET"),
      redirectUri: requireHttpsUrl(env.GOOGLE_REDIRECT_URI, "GOOGLE_REDIRECT_URI"),
      scopes: normalizeScopes(
        env.GOOGLE_YOUTUBE_SCOPES ||
          "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
      ),
      stateSecret,
    };
  }

  const graphVersion = String(env.META_GRAPH_API_VERSION || "").trim();
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error("META_GRAPH_API_VERSION must be configured for Facebook OAuth.");
  }

  return {
    platform: normalized,
    clientId: cleanSecret(env.META_APP_ID, "META_APP_ID"),
    clientSecret: cleanSecret(env.META_APP_SECRET, "META_APP_SECRET"),
    redirectUri: requireHttpsUrl(env.META_REDIRECT_URI, "META_REDIRECT_URI"),
    scopes: normalizeScopes(
      env.META_OAUTH_SCOPES ||
        "pages_show_list pages_read_engagement pages_manage_posts",
    ),
    stateSecret,
    graphVersion,
    graphBase: "https://graph.facebook.com",
  };
}

export function buildAuthorizationUrl(platform, config, state) {
  const normalized = normalizePlatform(platform);
  let url;

  if (normalized === "TIKTOK") {
    url = new URL("https://www.tiktok.com/v2/auth/authorize/");
    url.searchParams.set("client_key", config.clientId);
    url.searchParams.set("scope", config.scopes.join(","));
  } else if (normalized === "YOUTUBE") {
    url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("scope", config.scopes.join(" "));
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("include_granted_scopes", "true");
    url.searchParams.set("prompt", "consent");
  } else {
    url = new URL(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("scope", config.scopes.join(","));
  }

  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function createSignedOAuthState({ channelId, platform, secret, now = Date.now() }) {
  assertId(channelId, "channel");
  const normalized = normalizePlatform(platform);
  const state = randomBytes(24).toString("base64url");
  const payload = {
    channelId,
    platform: normalized,
    state,
    expiresAt: now + STATE_TTL_SECONDS * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = sign(encoded, secret);
  return {
    state,
    cookieValue: `${encoded}.${signature}`,
  };
}

export function verifySignedOAuthState({
  state,
  cookieValue,
  secret,
  now = Date.now(),
}) {
  const callbackState = cleanRequired(state, "OAuth state", 512);
  const cookie = cleanRequired(cookieValue, "OAuth state cookie", 4096);
  const [encoded, signature, ...rest] = cookie.split(".");
  if (!encoded || !signature || rest.length > 0) throw new Error("OAuth state cookie is invalid.");

  const expected = sign(encoded, secret);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    throw new Error("OAuth state cookie signature is invalid.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("OAuth state cookie payload is invalid.");
  }

  if (payload?.state !== callbackState) throw new Error("OAuth state mismatch.");
  if (!Number.isFinite(payload?.expiresAt) || payload.expiresAt < now) {
    throw new Error("OAuth authorization request expired.");
  }
  assertId(payload.channelId, "channel");
  payload.platform = normalizePlatform(payload.platform);
  return payload;
}

function normalizeCredentials(platform, token, now, previous = {}) {
  const accessToken = cleanRequired(
    token?.access_token || token?.accessToken,
    `${platform} access token`,
    10000,
  );
  const expiresIn = positiveNumber(token?.expires_in ?? token?.expiresIn);
  const refreshToken =
    cleanOptional(token?.refresh_token || token?.refreshToken, 10000) ||
    previous.refreshToken ||
    null;
  const refreshExpiresIn = positiveNumber(
    token?.refresh_expires_in ?? token?.refreshExpiresIn,
  );

  return {
    accessToken,
    refreshToken,
    tokenType: cleanOptional(token?.token_type || token?.tokenType, 80) || "Bearer",
    scope: cleanOptional(token?.scope, 4000),
    expiresAt: expiresIn ? new Date(now + expiresIn * 1000).toISOString() : null,
    refreshExpiresAt: refreshExpiresIn
      ? new Date(now + refreshExpiresIn * 1000).toISOString()
      : previous.refreshExpiresAt || null,
    externalAccountId:
      cleanOptional(token?.externalAccountId || token?.open_id, 300) ||
      previous.externalAccountId ||
      null,
  };
}

function pageCredentials(credentials, page) {
  return {
    ...credentials,
    userAccessToken: credentials.userAccessToken || credentials.accessToken,
    accessToken: page.accessToken,
    pageId: page.id,
    pageName: page.name,
    externalAccountId: page.id,
  };
}

async function fetchYouTubeChannelId(fetchImpl, accessToken) {
  if (!accessToken) return null;
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "id");
  url.searchParams.set("mine", "true");
  const body = await fetchJson(
    fetchImpl,
    url,
    { headers: { Authorization: `Bearer ${accessToken}` } },
    "YouTube",
  );
  return cleanOptional(body?.items?.[0]?.id, 300);
}

async function postForm(fetchImpl, url, fields, platform) {
  return fetchJson(
    fetchImpl,
    url,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(fields).toString(),
    },
    platform,
  );
}

async function fetchJson(fetchImpl, url, init, platform) {
  if (typeof fetchImpl !== "function") throw new Error("No fetch implementation is available.");
  const response = await fetchImpl(url, init);
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }

  if (!response.ok || body?.error) {
    const message =
      body?.error_description ||
      body?.error?.message ||
      (typeof body?.error === "string" ? body.error : null) ||
      `${platform} OAuth returned HTTP ${response.status}.`;
    throw new Error(message);
  }
  return body || {};
}

function sign(encoded, secret) {
  const key = cleanSecret(secret, "OAuth state secret");
  return createHmac("sha256", key).update(encoded).digest("base64url");
}

function cleanSecret(value, label) {
  const text = String(value || "").trim();
  if (text.length < 16) throw new Error(`${label} is not configured.`);
  return text;
}

function requireHttpsUrl(value, label) {
  const text = String(value || "").trim();
  try {
    const url = new URL(text);
    if (url.protocol !== "https:") throw new Error("https required");
    return url.toString();
  } catch {
    throw new Error(`${label} must be a registered HTTPS URL.`);
  }
}

function normalizeScopes(value) {
  const scopes = String(value || "")
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
  if (scopes.length === 0) throw new Error("At least one OAuth scope is required.");
  return [...new Set(scopes)];
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toUpperCase();
  if (!PLATFORMS.has(platform)) throw new Error("Unsupported OAuth platform.");
  return platform;
}

function cleanRequired(value, label, maxLength) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text.slice(0, maxLength);
}

function cleanOptional(value, maxLength) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function assertId(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
