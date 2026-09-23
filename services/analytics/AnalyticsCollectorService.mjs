import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { CredentialVault } from "../security/CredentialVault.mjs";
import { createPublishingProvider } from "../publishing/createPublishingProvider.mjs";
import { AnalyticsService } from "./AnalyticsService.mjs";

export class AnalyticsCollectorService {
  constructor(options = {}) {
    this.analytics = options.analytics || new AnalyticsService();
    this.publications = options.publications || new PublicationService();
    this.channels = options.channels || new ChannelService();
    this.credentials = options.credentials || new CredentialVault();
    this.providerFactory =
      options.providerFactory || ((platform) => createPublishingProvider(platform));
  }

  supportsPlatform(platform) {
    try {
      return typeof this.providerFactory(platform)?.getAnalytics === "function";
    } catch {
      return false;
    }
  }

  async collect(publicationId, options = {}) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    if (publication.status !== "PUBLISHED" || !publication.externalPostId) {
      throw new Error("Analytics can only be collected for a PUBLISHED publication.");
    }

    const channel = await this.channels.getChannel(publication.channelId);
    if (!channel) throw new Error("Channel not found.");

    const provider = this.providerFactory(channel.platform);
    if (typeof provider.getAnalytics !== "function") {
      return {
        supported: false,
        platform: channel.platform,
        publicationId,
        snapshot: null,
        reason: "PROVIDER_ANALYTICS_NOT_IMPLEMENTED",
      };
    }

    const credentials = await this.credentials.get(channel.id);
    if (!credentials) throw new Error("OAuth credentials are not configured for this channel.");

    const result = await provider.getAnalytics({
      publication,
      channel,
      credentials,
      externalPostId: publication.externalPostId,
    });

    if (!result?.metrics || typeof result.metrics !== "object") {
      throw new Error("Provider analytics response did not contain normalized metrics.");
    }

    const snapshot = await this.analytics.record({
      publicationId,
      platform: channel.platform,
      provider: result.provider || channel.platform.toLowerCase(),
      metrics: result.metrics,
      capturedAt: options.capturedAt || new Date().toISOString(),
    });

    return {
      supported: true,
      platform: channel.platform,
      publicationId,
      snapshot,
      reason: null,
    };
  }
}
