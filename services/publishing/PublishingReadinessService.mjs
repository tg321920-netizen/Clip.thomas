import { stat } from "node:fs/promises";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { CredentialVault } from "../security/CredentialVault.mjs";
import { createPublishingProvider } from "./createPublishingProvider.mjs";

export class PublishingReadinessService {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
    this.channels = options.channels || new ChannelService();
    this.credentials = options.credentials || new CredentialVault();
    this.providerFactory =
      options.providerFactory || ((platform) => createPublishingProvider(platform));
  }

  async check(publicationId) {
    const reasons = [];
    const publication = await this.publications.get(publicationId);

    if (!publication) {
      return {
        ready: false,
        publication: null,
        channel: null,
        requirements: null,
        reasons: ["PUBLICATION_NOT_FOUND"],
      };
    }

    const channel = await this.channels.getChannel(publication.channelId);
    if (!channel) reasons.push("CHANNEL_NOT_FOUND");
    if (channel && channel.status !== "CONNECTED") reasons.push("CHANNEL_NOT_CONNECTED");
    if (channel && channel.publishingEnabled !== true) reasons.push("CHANNEL_PUBLISHING_DISABLED");

    const provider = channel ? this.providerFactory(channel.platform) : null;
    const requirements = provider?.requirements?.() || null;

    if (this.credentials.isConfigured?.() !== true) {
      reasons.push("CREDENTIAL_VAULT_NOT_CONFIGURED");
    } else if (channel) {
      try {
        const credentials = await this.credentials.get(channel.id);
        if (!credentials?.accessToken) reasons.push("OAUTH_NOT_CONFIGURED");
        if (channel.platform === "FACEBOOK" && !credentials?.pageId) {
          reasons.push("FACEBOOK_PAGE_ID_REQUIRED");
        }
      } catch {
        reasons.push("OAUTH_NOT_CONFIGURED");
      }
    }

    const project = await loadProjectFile(publication.projectId);
    const clip = Array.isArray(project?.clips)
      ? project.clips.find((entry) => entry.id === publication.clipId)
      : null;

    if (!project) reasons.push("PROJECT_NOT_FOUND");
    if (!clip) reasons.push("CLIP_NOT_FOUND");
    if (clip && (clip.status !== "READY" || !clip.render?.relativePath)) {
      reasons.push("CLIP_NOT_READY");
    }

    if (clip?.render?.relativePath) {
      try {
        const info = await stat(resolveStoragePath(clip.render.relativePath));
        if (!info.isFile() || info.size <= 0) reasons.push("RENDER_FILE_INVALID");
      } catch {
        reasons.push("RENDER_FILE_MISSING");
      }
    }

    if (!publication.metadataApprovedAt) reasons.push("METADATA_APPROVAL_REQUIRED");

    if (publication.platform === "TIKTOK") {
      if (!publication.consentAt) reasons.push("TIKTOK_CONSENT_REQUIRED");
      if (!publication.platformSettings?.privacyLevel) {
        reasons.push("TIKTOK_PRIVACY_REQUIRED");
      }
      if (!isHttpsUrl(publication.platformSettings?.publicVideoUrl)) {
        reasons.push("TIKTOK_VERIFIED_MEDIA_URL_REQUIRED");
      }
    }

    if (
      publication.platform === "FACEBOOK" &&
      !/^v\d+\.\d+$/.test(process.env.META_GRAPH_API_VERSION?.trim() || "")
    ) {
      reasons.push("META_GRAPH_VERSION_REQUIRED");
    }

    return {
      ready: reasons.length === 0,
      publication,
      channel,
      requirements,
      reasons: [...new Set(reasons)],
    };
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(String(value || "")).protocol === "https:";
  } catch {
    return false;
  }
}
