import { loadProjectFile } from "../../lib/project-files.mjs";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { CredentialVault } from "../security/CredentialVault.mjs";
import { createPublishingProvider } from "./createPublishingProvider.mjs";

export class PublishingService {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
    this.channels = options.channels || new ChannelService();
    this.credentials = options.credentials || new CredentialVault();
    this.providerFactory =
      options.providerFactory || ((platform) => createPublishingProvider(platform));
  }

  async getChannelReadiness(channelId) {
    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    const provider = this.providerFactory(channel.platform);
    const vaultConfigured = this.credentials.isConfigured?.() === true;
    let credentialsConfigured = false;

    if (vaultConfigured) {
      try {
        credentialsConfigured = Boolean(await this.credentials.get(channelId));
      } catch {
        credentialsConfigured = false;
      }
    }

    return {
      channelId,
      platform: channel.platform,
      channelConnected:
        channel.status === "CONNECTED" && channel.publishingEnabled === true,
      vaultConfigured,
      credentialsConfigured,
      requirements: provider.requirements(),
    };
  }

  async publishPublication(publicationId, options = {}) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");

    if (publication.status === "PUBLISHED") {
      return { publication, reused: true, providerResult: null };
    }
    if (publication.status !== "SCHEDULED") {
      throw new Error(`Publication must be SCHEDULED, got ${publication.status}.`);
    }
    if (!publication.metadataApprovedAt) {
      throw new Error("Publication metadata must be approved before publishing.");
    }

    const now = options.now || new Date();
    const scheduledAt = new Date(publication.scheduledAt || 0);
    if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() > now.getTime()) {
      throw new Error("Publication is not due yet.");
    }

    const channel = await this.channels.getChannel(publication.channelId);
    if (!channel) throw new Error("Channel not found.");
    if (channel.status !== "CONNECTED" || channel.publishingEnabled !== true) {
      throw new Error("Channel is not enabled for publishing.");
    }

    const credentials = await this.credentials.get(channel.id);
    if (!credentials) {
      throw new Error("OAuth credentials are not configured for this channel.");
    }

    const project = await loadProjectFile(publication.projectId);
    if (!project) throw new Error("Project not found.");

    const clip = Array.isArray(project.clips)
      ? project.clips.find((entry) => entry.id === publication.clipId)
      : null;
    if (!clip?.render?.relativePath || clip.status !== "READY") {
      throw new Error("Publication clip is not READY.");
    }

    const provider = this.providerFactory(channel.platform);
    const publishing = await this.publications.markPublishing(publication.id);

    try {
      const providerResult = await provider.publish({
        publication: publishing,
        channel,
        credentials,
        settings: publishing.platformSettings || {},
        media: {
          filePath: resolveStoragePath(clip.render.relativePath),
          publicUrl: publishing.platformSettings?.publicVideoUrl || null,
          durationSeconds: clip.duration,
          width: clip.render.width,
          height: clip.render.height,
          sizeBytes: clip.render.sizeBytes,
        },
      });

      let saved = await this.publications.markSubmitted(
        publication.id,
        providerResult.externalPostId,
      );

      if (providerResult.providerStatus === "PUBLISHED") {
        saved = await this.publications.markPublished(
          publication.id,
          providerResult.externalPostId,
        );
      }

      return {
        publication: saved,
        reused: false,
        providerResult,
      };
    } catch (error) {
      await this.publications.markFailed(publication.id, error);
      throw error;
    }
  }

  async refreshPublicationStatus(publicationId) {
    const publication = await this.publications.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    if (publication.status === "PUBLISHED" || publication.status === "FAILED") {
      return { publication, changed: false, providerStatus: null };
    }
    if (publication.status !== "PUBLISHING" || !publication.externalPostId) {
      throw new Error("Publication is not awaiting provider status.");
    }

    const channel = await this.channels.getChannel(publication.channelId);
    if (!channel) throw new Error("Channel not found.");
    const credentials = await this.credentials.get(channel.id);
    if (!credentials) throw new Error("OAuth credentials are not configured for this channel.");

    const provider = this.providerFactory(channel.platform);
    const providerStatus = await provider.getStatus({
      publication,
      channel,
      credentials,
      externalPostId: publication.externalPostId,
    });

    const normalized = classifyProviderStatus(channel.platform, providerStatus);
    let saved = publication;

    if (normalized === "PUBLISHED") {
      saved = await this.publications.markPublished(publication.id);
    } else if (normalized === "FAILED") {
      saved = await this.publications.markFailed(
        publication.id,
        providerStatus.failReason || providerStatus.status || "Provider reported failure.",
      );
    }

    return {
      publication: saved,
      changed: saved.status !== publication.status,
      providerStatus,
    };
  }
}

export function classifyProviderStatus(platform, result = {}) {
  const value = String(result?.status || "").trim().toUpperCase();

  if (platform === "TIKTOK") {
    if (value === "PUBLISH_COMPLETE") return "PUBLISHED";
    if (value === "FAILED") return "FAILED";
    return "PENDING";
  }

  if (platform === "YOUTUBE") {
    if (value === "PROCESSED") return "PUBLISHED";
    if (["FAILED", "REJECTED", "DELETED"].includes(value)) return "FAILED";
    return "PENDING";
  }

  if (platform === "FACEBOOK") {
    if (["READY", "PUBLISHED", "COMPLETE", "COMPLETED"].includes(value)) {
      return "PUBLISHED";
    }
    if (["ERROR", "FAILED"].includes(value)) return "FAILED";
    return "PENDING";
  }

  return "PENDING";
}
