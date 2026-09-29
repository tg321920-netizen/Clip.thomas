import { createHash, randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { ApprovalService } from "../approvals/ApprovalService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { ContentGenerationRepository } from "../content-generation/ContentGenerationRepository.mjs";
import { MarketingEditRepository } from "../media-processing/MarketingEditRepository.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { MarketingPublishingRepository } from "./MarketingPublishingRepository.mjs";

const PLATFORMS = new Set(["FACEBOOK", "INSTAGRAM", "TIKTOK", "YOUTUBE"]);

export class MarketingPublishingHub {
  constructor(options = {}) {
    this.repository = options.repository || new MarketingPublishingRepository();
    this.content = options.content || new ContentGenerationRepository();
    this.edits = options.edits || new MarketingEditRepository();
    this.channels = options.channels || new ChannelService();
    this.publications = options.publications || new PublicationService();
    this.approvals = options.approvals || new ApprovalService();
  }

  async list(filters = {}) {
    return this.repository.list({
      ...(filters.generationId ? { generationId: normalizeId(filters.generationId, "content generation") } : {}),
      ...(filters.platform ? { platform: normalizePlatform(filters.platform) } : {}),
      ...(filters.status ? { status: String(filters.status).trim().toUpperCase() } : {}),
    });
  }

  async get(id) {
    return this.repository.get(normalizeId(id, "marketing publication"));
  }

  async simulate(input = {}) {
    const generationId = normalizeId(input.generationId, "content generation");
    const generation = await this.content.get(generationId);
    if (!generation) throw new Error("Content generation not found.");
    if (generation.status !== "APPROVED" || !generation.selectedVariantId) {
      throw new Error("Content must be approved before publication simulation.");
    }
    const variant = (generation.variants || []).find((item) => item.id === generation.selectedVariantId);
    if (!variant) throw new Error("Approved variant not found.");

    const platform = normalizePlatform(input.platform || inferPlatform(generation.channels));
    const channelId = input.channelId ? normalizeId(input.channelId, "channel") : null;
    const channel = channelId ? await this.channels.getChannel(channelId) : null;
    if (channelId && !channel) throw new Error("Channel not found.");
    if (channel && platform !== channel.platform) {
      throw new Error("Selected channel platform does not match the simulation platform.");
    }

    const scheduledAt = normalizeOptionalDate(input.scheduledAt);
    const payload = {
      title: variant.title || "",
      description: variant.description || variant.adCopy || "",
      hashtags: Array.isArray(variant.hashtags) ? variant.hashtags : [],
      cta: variant.cta || "",
      media: { source: "approved-content", generationId, variantId: variant.id },
      scheduledAt,
    };
    const idempotencyKey = hash(`${generationId}:${variant.id}:${platform}:${channelId || "dry"}:${scheduledAt || "now"}`);
    const existing = await this.repository.findByIdempotencyKey(idempotencyKey);
    if (existing) return { simulation: existing, reused: true };

    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      idempotencyKey,
      generationId,
      projectId: generation.projectId || null,
      variantId: variant.id,
      platform,
      channelId,
      dryRun: true,
      status: "SIMULATED",
      label: "Simulación de publicación",
      payload,
      publicationApprovalRequired: true,
      approvalId: null,
      livePublicationId: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.save(record);
    return { simulation: record, reused: false };
  }

  async requestPublicationApproval(simulationId) {
    const id = normalizeId(simulationId, "marketing publication");
    const simulation = await this.repository.get(id);
    if (!simulation) throw new Error("Publication simulation not found.");
    if (!simulation.dryRun) throw new Error("Only a dry-run simulation can request publication approval here.");
    if (simulation.approvalId) {
      const approval = await this.approvals.get(simulation.approvalId);
      if (approval) return { approval, reused: true };
    }
    const result = await this.approvals.request({
      subjectType: "PUBLICATION",
      subjectId: simulation.id,
      projectId: simulation.projectId,
      title: `${simulation.platform}: publicación lista`,
      message: "La simulación está lista. Revisá el contenido y aprobá explícitamente antes de habilitar cualquier publicación real.",
      details: { dryRun: true, payload: simulation.payload, channelId: simulation.channelId },
    });
    const updated = { ...simulation, status: "WAITING_APPROVAL", approvalId: result.approval.id, updatedAt: new Date().toISOString() };
    await this.repository.save(updated);
    return result;
  }

  async handoffToAuthorizedPublishing(simulationId, options = {}) {
    const id = normalizeId(simulationId, "marketing publication");
    const simulation = await this.repository.get(id);
    if (!simulation) throw new Error("Publication simulation not found.");
    if (simulation.platform === "INSTAGRAM") {
      throw new Error("Instagram live publishing connector is not implemented yet; keep this item in DRY RUN.");
    }
    if (!simulation.approvalId) throw new Error("Publication approval is required before live handoff.");
    const approval = await this.approvals.get(simulation.approvalId);
    if (!approval || approval.status !== "APPROVED") {
      throw new Error("Publication has not received explicit human approval.");
    }
    if (String(process.env.CLIPFORGE_MARKETING_REAL_PUBLISHING || "").toLowerCase() !== "true") {
      throw new Error("Real marketing publishing is disabled. Set CLIPFORGE_MARKETING_REAL_PUBLISHING=true only when intentionally activating authorized accounts.");
    }

    const channelId = normalizeId(options.channelId || simulation.channelId, "channel");
    const channel = await this.channels.getChannel(channelId);
    if (!channel || channel.status !== "CONNECTED" || channel.publishingEnabled !== true) {
      throw new Error("A connected, publishing-enabled authorized channel is required.");
    }
    if (channel.platform !== simulation.platform) throw new Error("Authorized channel platform does not match simulation platform.");

    const edits = await this.edits.list({ generationId: simulation.generationId });
    const edit = edits.find((item) => item.clipId && ["CLIP_PREPARED", "READY"].includes(item.status));
    if (!edit?.projectId || !edit?.clipId) {
      throw new Error("A prepared ClipForge media clip is required before live publishing handoff.");
    }

    const result = await this.publications.createForClip({
      projectId: edit.projectId,
      clipId: edit.clipId,
      channelId,
      approvalRequired: true,
    });

    const updated = {
      ...simulation,
      dryRun: false,
      status: "HANDED_OFF",
      channelId,
      livePublicationId: result.publication.id,
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(updated);
    return { simulation: updated, publication: result.publication, reused: result.reused };
  }
}

function inferPlatform(channels) {
  const values = Array.isArray(channels) ? channels : [];
  const first = values[0] || "FACEBOOK_REELS";
  if (String(first).startsWith("INSTAGRAM")) return "INSTAGRAM";
  if (String(first).startsWith("TIKTOK")) return "TIKTOK";
  if (String(first).startsWith("YOUTUBE")) return "YOUTUBE";
  return "FACEBOOK";
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toUpperCase();
  if (!PLATFORMS.has(platform)) throw new Error(`Unsupported publishing platform: ${platform || "missing"}.`);
  return platform;
}

function normalizeOptionalDate(value) {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("scheduledAt is invalid.");
  return date.toISOString();
}

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}

function hash(value) { return createHash("sha256").update(value).digest("hex"); }
