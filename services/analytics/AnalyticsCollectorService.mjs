import { AnalyticsService } from "./AnalyticsService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { CredentialVault } from "../security/CredentialVault.mjs";
import { createPublishingProvider } from "../publishing/createPublishingProvider.mjs";

export class AnalyticsCollectorService {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
    this.channels = options.channels || new ChannelService();
    this.credentials = options.credentials || new CredentialVault();
    this.analytics = options.analytics || new AnalyticsService({
      publications: this.publications,
    });
    this.providerFactory =
      options.providerFactory || ((platform) => createPublishingProvider(platform));
  }

  async collectPublication(publicationId) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    if (publication.status !== "PUBLISHED") {
      return {
        publicationId,
        collected: false,
        reason: "PUBLICATION_NOT_PUBLISHED",
        snapshot: null,
      };
    }
    if (!publication.externalPostId) {
      return {
        publicationId,
        collected: false,
        reason: "EXTERNAL_POST_ID_MISSING",
        snapshot: null,
      };
    }

    const channel = await this.channels.getChannel(publication.channelId);
    if (!channel) {
      return {
        publicationId,
        collected: false,
        reason: "CHANNEL_NOT_FOUND",
        snapshot: null,
      };
    }

    const provider = this.providerFactory(channel.platform);
    if (typeof provider?.getAnalytics !== "function") {
      return {
        publicationId,
        collected: false,
        reason: "PROVIDER_ANALYTICS_UNSUPPORTED",
        snapshot: null,
      };
    }

    if (this.credentials.isConfigured?.() !== true) {
      return {
        publicationId,
        collected: false,
        reason: "CREDENTIAL_VAULT_NOT_CONFIGURED",
        snapshot: null,
      };
    }

    const credentials = await this.credentials.get(channel.id);
    if (!credentials?.accessToken) {
      return {
        publicationId,
        collected: false,
        reason: "OAUTH_NOT_CONFIGURED",
        snapshot: null,
      };
    }

    const providerAnalytics = await provider.getAnalytics({
      publication,
      channel,
      credentials,
      externalPostId: publication.externalPostId,
    });

    const metrics = normalizeProviderMetrics(providerAnalytics);
    const snapshot = await this.analytics.recordSnapshot({
      publicationId: publication.id,
      platform: publication.platform,
      source: providerAnalytics?.source || `${publication.platform.toLowerCase()}-provider`,
      metrics,
    });

    return {
      publicationId,
      collected: true,
      reason: null,
      snapshot,
    };
  }

  async collectPublished(options = {}) {
    const minAgeMs = Math.max(0, Number(options.minAgeMs ?? 60 * 60 * 1000));
    const limit = Math.max(1, Math.min(100, Number(options.limit ?? 25)));
    const publications = await this.publications.list({ status: "PUBLISHED" });
    const results = [];

    for (const publication of publications.slice(0, limit)) {
      const latest = await this.analytics.latest(publication.id);
      if (
        latest &&
        Number.isFinite(Date.parse(latest.capturedAt)) &&
        Date.now() - Date.parse(latest.capturedAt) < minAgeMs
      ) {
        results.push({
          publicationId: publication.id,
          collected: false,
          reason: "RECENT_SNAPSHOT_EXISTS",
          snapshot: latest,
        });
        continue;
      }

      try {
        results.push(await this.collectPublication(publication.id));
      } catch (error) {
        results.push({
          publicationId: publication.id,
          collected: false,
          reason: "PROVIDER_REQUEST_FAILED",
          error: error instanceof Error ? error.message : String(error),
          snapshot: null,
        });
      }
    }

    return results;
  }
}

export function normalizeProviderMetrics(value = {}) {
  const allowed = [
    "views",
    "likes",
    "comments",
    "shares",
    "saves",
    "watchTimeSeconds",
    "averageWatchTimeSeconds",
    "averageViewDurationSeconds",
    "followersGained",
    "impressions",
    "reach",
  ];
  const metrics = {};

  for (const key of allowed) {
    if (!Object.hasOwn(value, key)) continue;
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) metrics[key] = number;
  }

  return metrics;
}
