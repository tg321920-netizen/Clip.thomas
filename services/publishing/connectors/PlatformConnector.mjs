import { AnalyticsCollectorService } from "../../analytics/AnalyticsCollectorService.mjs";
import { ChannelService } from "../../channels/ChannelService.mjs";
import { OAuthConnectionService } from "../../oauth/OAuthConnectionService.mjs";
import { CredentialVault } from "../../security/CredentialVault.mjs";
import { PublishingService } from "../PublishingService.mjs";
import { PublishingProviderError } from "../PublishingProvider.mjs";
import { createPublishingProvider } from "../createPublishingProvider.mjs";

export class PlatformConnector {
  constructor(platform, options = {}) {
    this.platform = normalizePlatform(platform);
    this.channels = options.channels || new ChannelService();
    this.credentials = options.credentials || new CredentialVault();
    this.oauth = options.oauth || new OAuthConnectionService({
      channels: this.channels,
      vault: this.credentials,
    });
    this.providerFactory =
      options.providerFactory || ((value) => createPublishingProvider(value));
    this.publishing = options.publishing || new PublishingService({
      channels: this.channels,
      credentials: this.credentials,
      oauth: this.oauth,
      providerFactory: this.providerFactory,
    });
    this.analytics = options.analytics || new AnalyticsCollectorService({
      channels: this.channels,
      credentials: this.credentials,
      providerFactory: this.providerFactory,
    });
  }

  async getStatus(channelId) {
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");
    if (channel.platform !== this.platform) {
      throw new Error(`Channel platform does not match ${this.platform} connector.`);
    }

    const provider = this.providerFactory(this.platform);
    const vaultConfigured = this.credentials.isConfigured?.() === true;
    let credentials = null;
    if (vaultConfigured) {
      try {
        credentials = await this.credentials.get(channel.id);
      } catch {
        credentials = null;
      }
    }

    const oauth = oauthStatus(credentials, vaultConfigured);
    const requirements =
      typeof provider?.requirements === "function" ? provider.requirements() : {};

    return {
      platform: this.platform,
      channelId: channel.id,
      channelName: channel.name,
      connected: channel.status === "CONNECTED",
      channelStatus: channel.status,
      publishingEnabled: channel.publishingEnabled === true,
      externalAccountId:
        channel.externalAccountId ||
        credentials?.externalAccountId ||
        credentials?.pageId ||
        null,
      oauth,
      capabilities: {
        publish: typeof provider?.publish === "function",
        statusCheck: typeof provider?.getStatus === "function",
        analytics: typeof provider?.getAnalytics === "function",
        scheduling: "CLIPFORGE",
        nativeScheduling: false,
        refreshHandledByOAuthService: true,
      },
      requirements,
      publishingReady:
        channel.status === "CONNECTED" &&
        channel.publishingEnabled === true &&
        oauth.state === "VALID",
    };
  }

  async publish(publicationId, options = {}) {
    if (options.allowRealPublishing !== true) {
      throw new PublishingProviderError("Agent real publishing is disabled.", {
        code: "AGENT_REAL_PUBLISHING_OFF",
        retryable: false,
      });
    }

    try {
      return await this.publishing.publishPublication(publicationId, options);
    } catch (error) {
      throw normalizeConnectorException(error, this.platform);
    }
  }

  async refreshPublicationStatus(publicationId) {
    try {
      return await this.publishing.refreshPublicationStatus(publicationId);
    } catch (error) {
      throw normalizeConnectorException(error, this.platform);
    }
  }

  async collectAnalytics(publicationId) {
    try {
      return await this.analytics.collectPublication(publicationId);
    } catch (error) {
      throw normalizeConnectorException(error, this.platform);
    }
  }
}

export function normalizeConnectorError(error, platform = null) {
  const normalized = normalizeConnectorException(error, platform);
  return {
    platform: normalized.platform || platform || null,
    code: normalized.code,
    message: normalized.message,
    retryable: normalized.retryable === true,
    rateLimited: normalized.rateLimited === true,
    reauthorizationRequired: normalized.reauthorizationRequired === true,
  };
}

function normalizeConnectorException(error, platform) {
  if (error instanceof ConnectorError) return error;
  const code = String(error?.code || "PLATFORM_CONNECTOR_ERROR");
  const message = error instanceof Error ? error.message : String(error);
  const retryable = error?.retryable === true;
  return new ConnectorError(message, {
    platform,
    code,
    retryable,
    rateLimited: /429|rate.?limit/i.test(code) || /rate.?limit/i.test(message),
    reauthorizationRequired:
      /OAUTH|TOKEN|AUTH/i.test(code) &&
      !retryable,
    cause: error,
  });
}

export class ConnectorError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ConnectorError";
    this.platform = options.platform || null;
    this.code = options.code || "PLATFORM_CONNECTOR_ERROR";
    this.retryable = options.retryable === true;
    this.rateLimited = options.rateLimited === true;
    this.reauthorizationRequired = options.reauthorizationRequired === true;
    this.cause = options.cause;
  }
}

function oauthStatus(credentials, vaultConfigured) {
  if (!vaultConfigured) {
    return { state: "VAULT_NOT_CONFIGURED", expiresAt: null, refreshAvailable: false };
  }
  if (!credentials?.accessToken) {
    return { state: "MISSING", expiresAt: null, refreshAvailable: false };
  }
  const expiresAt = credentials.expiresAt || null;
  const expires = Date.parse(expiresAt || "");
  if (Number.isFinite(expires) && expires <= Date.now()) {
    return {
      state: "EXPIRED",
      expiresAt,
      refreshAvailable: Boolean(credentials.refreshToken),
    };
  }
  return {
    state: "VALID",
    expiresAt,
    refreshAvailable: Boolean(credentials.refreshToken),
  };
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toUpperCase();
  if (!["TIKTOK", "FACEBOOK", "YOUTUBE"].includes(platform)) {
    throw new Error("Unsupported social connector platform.");
  }
  return platform;
}
