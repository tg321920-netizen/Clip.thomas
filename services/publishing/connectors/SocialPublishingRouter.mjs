import { ChannelService } from "../../channels/ChannelService.mjs";
import { PublicationService } from "../../publications/PublicationService.mjs";
import { SchedulerService } from "../../scheduler/SchedulerService.mjs";
import { agentRealPublishingEnabled } from "../../agent/AutonomyPolicy.mjs";
import { FacebookConnector } from "./FacebookConnector.mjs";
import { TikTokConnector } from "./TikTokConnector.mjs";
import { YouTubeConnector } from "./YouTubeConnector.mjs";
import { normalizeConnectorError } from "./PlatformConnector.mjs";

export class SocialPublishingRouter {
  constructor(options = {}) {
    this.channels = options.channels || new ChannelService();
    this.publications = options.publications || new PublicationService({
      channels: this.channels,
    });
    this.scheduler = options.scheduler || new SchedulerService({
      channels: this.channels,
      publications: this.publications,
    });

    const shared = {
      channels: this.channels,
      ...(options.credentials ? { credentials: options.credentials } : {}),
      ...(options.oauth ? { oauth: options.oauth } : {}),
      ...(options.providerFactory ? { providerFactory: options.providerFactory } : {}),
      ...(options.publishing ? { publishing: options.publishing } : {}),
      ...(options.analytics ? { analytics: options.analytics } : {}),
    };

    this.connectors = new Map([
      ["TIKTOK", options.tiktok || new TikTokConnector(shared)],
      ["FACEBOOK", options.facebook || new FacebookConnector(shared)],
      ["YOUTUBE", options.youtube || new YouTubeConnector(shared)],
    ]);
  }

  connectorFor(platform) {
    const key = normalizePlatform(platform);
    const connector = this.connectors.get(key);
    if (!connector) throw new Error(`No connector registered for ${key}.`);
    return connector;
  }

  async listChannelStatuses(filters = {}) {
    const channels = await this.channels.listChannels(
      filters.scope ? { scope: filters.scope } : {},
    );
    const rows = [];
    for (const channel of channels) {
      try {
        rows.push(await this.connectorFor(channel.platform).getStatus(channel.id));
      } catch (error) {
        rows.push({
          platform: channel.platform,
          channelId: channel.id,
          channelName: channel.name,
          connected: channel.status === "CONNECTED",
          channelStatus: channel.status,
          publishingEnabled: channel.publishingEnabled === true,
          externalAccountId: channel.externalAccountId || null,
          publishingReady: false,
          error: normalizeConnectorError(error, channel.platform),
        });
      }
    }
    return rows;
  }

  async prepareClip(input = {}) {
    const requestedPlatforms = normalizePlatforms(input.platforms);
    const requestedChannelIds = new Set(
      Array.isArray(input.channelIds) ? input.channelIds.map(String) : [],
    );
    const channels = await this.channels.listChannels(
      input.scope ? { scope: input.scope } : {},
    );
    const selected = channels.filter((channel) => {
      if (requestedChannelIds.size > 0 && !requestedChannelIds.has(channel.id)) return false;
      if (requestedPlatforms.size > 0 && !requestedPlatforms.has(channel.platform)) return false;
      return true;
    });

    const results = [];
    for (const channel of selected) {
      const status = await this.connectorFor(channel.platform).getStatus(channel.id);
      if (!status.publishingReady) {
        results.push({
          channelId: channel.id,
          platform: channel.platform,
          prepared: false,
          reason: status.oauth?.state !== "VALID"
            ? "OAUTH_NOT_READY"
            : "CHANNEL_NOT_ENABLED",
          status,
        });
        continue;
      }
      const created = await this.publications.createForClip({
        projectId: input.projectId,
        clipId: input.clipId,
        channelId: channel.id,
        approvalRequired: input.approvalRequired !== false,
      });
      results.push({
        channelId: channel.id,
        platform: channel.platform,
        prepared: true,
        reused: created.reused,
        publication: created.publication,
      });
    }

    return {
      projectId: input.projectId,
      clipId: input.clipId,
      results,
    };
  }

  async schedulePublication(publicationId, config = {}, options = {}) {
    this.#assertRealPublishingAllowed(options);
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    const status = await this.connectorFor(publication.platform).getStatus(
      publication.channelId,
    );
    if (!status.publishingReady) throw new Error("Social connector is not ready for publishing.");
    return this.scheduler.schedulePublication(publicationId, config, options);
  }

  async publishPublication(publicationId, options = {}) {
    this.#assertRealPublishingAllowed(options);
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    const connector = this.connectorFor(publication.platform);
    const status = await connector.getStatus(publication.channelId);
    if (!status.publishingReady) throw new Error("Social connector is not ready for publishing.");
    return connector.publish(publicationId, { ...options, allowRealPublishing: true });
  }

  async publishContent(input = {}, options = {}) {
    const publicationIds = Array.isArray(input.publicationIds)
      ? [...new Set(input.publicationIds.map(String))]
      : [];
    if (publicationIds.length === 0) throw new Error("publicationIds are required.");

    const results = [];
    for (const publicationId of publicationIds) {
      try {
        results.push({
          publicationId,
          ok: true,
          result: await this.publishPublication(publicationId, options),
        });
      } catch (error) {
        results.push({
          publicationId,
          ok: false,
          error: normalizeConnectorError(error),
        });
      }
    }
    return { results };
  }

  async refreshPublicationStatus(publicationId) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    return this.connectorFor(publication.platform).refreshPublicationStatus(publicationId);
  }

  async collectAnalytics(publicationId) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    return this.connectorFor(publication.platform).collectAnalytics(publicationId);
  }

  #assertRealPublishingAllowed(options) {
    if (options.allowRealPublishing !== true || !agentRealPublishingEnabled()) {
      const error = new Error("Agent real publishing is disabled.");
      error.code = "AGENT_REAL_PUBLISHING_OFF";
      error.retryable = false;
      throw error;
    }
  }
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toUpperCase();
  if (!["TIKTOK", "FACEBOOK", "YOUTUBE"].includes(platform)) {
    throw new Error("Unsupported social platform.");
  }
  return platform;
}

function normalizePlatforms(value) {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.map(normalizePlatform));
}
