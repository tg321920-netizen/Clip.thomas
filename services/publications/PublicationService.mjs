import { randomUUID } from "node:crypto";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationRepository } from "./PublicationRepository.mjs";

const TERMINAL_OR_ACTIVE = new Set([
  "SCHEDULED",
  "PUBLISHING",
  "PUBLISHED",
]);

export class PublicationService {
  constructor(options = {}) {
    this.repository = options.repository || new PublicationRepository();
    this.channels = options.channels || new ChannelService();
  }

  async list(filters = {}) {
    return this.repository.list(filters);
  }

  async get(publicationId) {
    return this.repository.get(publicationId);
  }

  async createForClip({
    projectId,
    clipId,
    channelId,
    approvalRequired = true,
  }) {
    assertUuid(projectId, "project");
    assertUuid(clipId, "clip");
    assertUuid(channelId, "channel");

    const project = await loadProjectFile(projectId);
    if (!project) throw new Error("Project not found.");

    const clip = Array.isArray(project.clips)
      ? project.clips.find((entry) => entry.id === clipId)
      : null;

    if (!clip) throw new Error("Clip not found.");
    if (clip.status !== "READY" || !clip.render?.relativePath) {
      throw new Error("Clip must be READY before creating a publication.");
    }

    const channel = await this.channels.getChannel(channelId);
    if (!channel) throw new Error("Channel not found.");

    const idempotencyKey = buildIdempotencyKey(clipId, channelId);
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return { publication: existing, reused: true };
    }

    const metadata = getClipMetadata(project, clip);
    const now = new Date().toISOString();

    const publication = {
      id: randomUUID(),
      idempotencyKey,
      projectId,
      clipId,
      channelId,
      platform: channel.platform,
      title: cleanText(metadata.title, 160),
      description: cleanText(metadata.description, 2200),
      hashtags: normalizeHashtags(metadata.hashtags),
      platformSettings: {},
      consentAt: null,
      metadataApprovedAt: approvalRequired ? null : now,
      scheduledAt: null,
      publishedAt: null,
      status: approvalRequired ? "WAITING_APPROVAL" : "APPROVED",
      externalPostId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    await this.repository.save(publication);
    return { publication, reused: false };
  }

  async updateDraft(publicationId, input = {}) {
    const publication = await this.#require(publicationId);

    if (!["DRAFT", "WAITING_APPROVAL", "APPROVED", "FAILED"].includes(publication.status)) {
      throw new Error(`Publication cannot be edited from ${publication.status}.`);
    }

    if (Object.hasOwn(input, "title")) {
      publication.title = cleanText(input.title, 160);
      if (!publication.title) throw new Error("Publication title cannot be empty.");
    }
    if (Object.hasOwn(input, "description")) {
      publication.description = cleanText(input.description, 2200);
    }
    if (Object.hasOwn(input, "hashtags")) {
      publication.hashtags = normalizeHashtags(input.hashtags);
    }
    if (Object.hasOwn(input, "platformSettings")) {
      publication.platformSettings = normalizePlatformSettings(
        publication.platform,
        input.platformSettings,
      );
    }

    publication.status = "WAITING_APPROVAL";
    publication.consentAt = null;
    publication.metadataApprovedAt = null;
    publication.error = null;
    publication.updatedAt = new Date().toISOString();

    await this.repository.save(publication);
    return publication;
  }

  async approve(publicationId, options = {}) {
    const publication = await this.#require(publicationId);

    if (publication.status === "PUBLISHED") return publication;
    if (TERMINAL_OR_ACTIVE.has(publication.status)) return publication;

    if (!new Set(["WAITING_APPROVAL", "DRAFT", "FAILED", "APPROVED"]).has(publication.status)) {
      throw new Error(`Publication cannot be approved from ${publication.status}.`);
    }

    if (Object.hasOwn(options, "platformSettings")) {
      publication.platformSettings = normalizePlatformSettings(
        publication.platform,
        options.platformSettings,
      );
    }

    const now = new Date().toISOString();
    publication.status = publication.scheduledAt ? "SCHEDULED" : "APPROVED";
    publication.metadataApprovedAt = now;
    publication.consentAt = options.consent === true ? now : publication.consentAt;
    publication.error = null;
    publication.updatedAt = now;
    await this.repository.save(publication);
    return publication;
  }

  async schedule(publicationId, scheduledAt) {
    const publication = await this.#require(publicationId);

    if (publication.status === "WAITING_APPROVAL") {
      throw new Error("Publication must be approved before scheduling.");
    }
    if (publication.status === "PUBLISHED") return publication;
    if (!["APPROVED", "SCHEDULED", "FAILED"].includes(publication.status)) {
      throw new Error(`Publication cannot be scheduled from ${publication.status}.`);
    }

    const date = normalizeFutureDate(scheduledAt);
    publication.scheduledAt = date.toISOString();
    publication.status = "SCHEDULED";
    publication.error = null;
    publication.updatedAt = new Date().toISOString();
    await this.repository.save(publication);
    return publication;
  }

  async markPublishing(publicationId) {
    const publication = await this.#require(publicationId);
    if (publication.status === "PUBLISHED") return publication;
    if (publication.status !== "SCHEDULED") {
      throw new Error("Only SCHEDULED publications can start publishing.");
    }

    publication.status = "PUBLISHING";
    publication.error = null;
    publication.updatedAt = new Date().toISOString();
    await this.repository.save(publication);
    return publication;
  }

  async markSubmitted(publicationId, externalPostId) {
    const publication = await this.#require(publicationId);
    if (publication.status !== "PUBLISHING") {
      throw new Error("Publication must be PUBLISHING before provider submission.");
    }

    const externalId = cleanText(externalPostId, 300);
    if (!externalId) throw new Error("externalPostId is required.");

    publication.externalPostId = externalId;
    publication.error = null;
    publication.updatedAt = new Date().toISOString();
    await this.repository.save(publication);
    return publication;
  }

  async markPublished(publicationId, externalPostId = null) {
    const publication = await this.#require(publicationId);
    if (publication.status === "PUBLISHED") return publication;
    if (publication.status !== "PUBLISHING") {
      throw new Error("Publication must be PUBLISHING before completion.");
    }

    const externalId = cleanText(externalPostId || publication.externalPostId, 300);
    if (!externalId) throw new Error("externalPostId is required.");

    publication.status = "PUBLISHED";
    publication.externalPostId = externalId;
    publication.publishedAt = new Date().toISOString();
    publication.error = null;
    publication.updatedAt = publication.publishedAt;
    await this.repository.save(publication);
    return publication;
  }

  async markFailed(publicationId, error) {
    const publication = await this.#require(publicationId);
    if (publication.status === "PUBLISHED") return publication;

    publication.status = "FAILED";
    publication.error = cleanText(
      error instanceof Error ? error.message : String(error || "Publishing failed."),
      1000,
    );
    publication.updatedAt = new Date().toISOString();
    await this.repository.save(publication);
    return publication;
  }

  async #require(publicationId) {
    assertUuid(publicationId, "publication");
    const publication = await this.repository.get(publicationId);
    if (!publication) throw new Error("Publication not found.");
    return publication;
  }
}

export function buildIdempotencyKey(clipId, channelId) {
  assertUuid(clipId, "clip");
  assertUuid(channelId, "channel");
  return `${clipId}:${channelId}`;
}

export function normalizePlatformSettings(platform, value) {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};

  if (platform === "TIKTOK") {
    const output = {
      ...(typeof input.privacyLevel === "string"
        ? { privacyLevel: cleanText(input.privacyLevel, 80) }
        : {}),
      disableDuet: Boolean(input.disableDuet),
      disableComment: Boolean(input.disableComment),
      disableStitch: Boolean(input.disableStitch),
      brandContent: Boolean(input.brandContent),
      brandOrganic: Boolean(input.brandOrganic),
      ...(typeof input.isAigc === "boolean" ? { isAigc: input.isAigc } : {}),
    };

    if (typeof input.publicVideoUrl === "string" && input.publicVideoUrl.trim()) {
      const url = new URL(input.publicVideoUrl.trim());
      if (url.protocol !== "https:") {
        throw new Error("TikTok publicVideoUrl must use HTTPS.");
      }
      output.publicVideoUrl = url.toString();
    }

    return output;
  }

  if (platform === "YOUTUBE") {
    const privacyStatus = String(input.privacyStatus || "private").toLowerCase();
    if (!["private", "unlisted", "public"].includes(privacyStatus)) {
      throw new Error("Invalid YouTube privacyStatus.");
    }

    return {
      privacyStatus,
      madeForKids: Boolean(input.madeForKids),
      ...(typeof input.categoryId === "string" && input.categoryId.trim()
        ? { categoryId: cleanText(input.categoryId, 30) }
        : {}),
      ...(Array.isArray(input.tags)
        ? { tags: input.tags.map((tag) => cleanText(tag, 100)).filter(Boolean).slice(0, 30) }
        : {}),
    };
  }

  if (platform === "FACEBOOK") return {};
  throw new Error("Unsupported publication platform.");
}

function getClipMetadata(project, clip) {
  const candidate = project?.analysis?.candidates?.find(
    (entry) => entry.id === clip.candidateId,
  );

  return {
    title: clip?.autoEdit?.title || candidate?.title || "ClipForge clip",
    description:
      clip?.autoEdit?.description || candidate?.text || candidate?.reason || "",
    hashtags: clip?.autoEdit?.hashtags || [],
  };
}

function normalizeHashtags(value) {
  const input = Array.isArray(value) ? value : [];
  const output = [];
  const seen = new Set();

  for (const item of input) {
    const cleaned = String(item || "")
      .trim()
      .replace(/^#+/, "")
      .replace(/[^\p{L}\p{N}_]/gu, "")
      .slice(0, 60);
    if (!cleaned) continue;

    const tag = `#${cleaned}`;
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(tag);
    if (output.length >= 15) break;
  }

  return output;
}

function normalizeFutureDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("scheduledAt is invalid.");
  if (date.getTime() <= Date.now() - 60_000) {
    throw new Error("scheduledAt cannot be in the past.");
  }
  return date;
}

function cleanText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1)}…`
    : text;
}

function assertUuid(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}
