import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { prepareAutoEdit } from "../autoedit/AutoEditService.mjs";
import { BrandService } from "../branding/BrandService.mjs";
import { ContentGenerationRepository } from "../content-generation/ContentGenerationRepository.mjs";
import { MarketingEditRepository } from "./MarketingEditRepository.mjs";

export class MarketingEditService {
  constructor(options = {}) {
    this.content = options.content || new ContentGenerationRepository();
    this.brands = options.brands || new BrandService();
    this.repository = options.repository || new MarketingEditRepository();
    this.prepareAutoEdit = options.prepareAutoEdit || prepareAutoEdit;
  }

  async list(filters = {}) {
    return this.repository.list(filters);
  }

  async get(editId) {
    return this.repository.get(normalizeId(editId, "edit"));
  }

  async prepare(input = {}) {
    const generationId = normalizeId(input.generationId, "content generation");
    const generation = await this.content.get(generationId);
    if (!generation) throw new Error("Content generation not found.");
    if (generation.status !== "APPROVED" || !generation.selectedVariantId) {
      throw new Error("Content must be human-approved before automatic editing.");
    }

    const variant = (generation.variants || []).find((entry) => entry.id === generation.selectedVariantId);
    if (!variant) throw new Error("Approved content variant not found.");

    const brand = input.brandId ? await this.brands.get(normalizeId(input.brandId, "brand")) : null;
    if (input.brandId && !brand) throw new Error("Brand not found.");
    if (brand?.projectId && generation.projectId && brand.projectId !== generation.projectId) {
      throw new Error("Brand does not belong to this ClipForge project.");
    }

    const branded = this.brands.applyToVariant(brand, variant);
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      generationId,
      variantId: variant.id,
      projectId: generation.projectId || null,
      brandId: brand?.id || null,
      status: "PREPARED",
      sourceMode: generation.projectId ? "CLIPFORGE_PROJECT" : "ASSET_REQUIRED",
      clipId: null,
      renderReady: false,
      mediaPlan: buildMediaPlan(branded.variant),
      brandSnapshot: brand ? snapshotBrand(brand) : null,
      editTemplate: {
        quality: input.quality || null,
        framingMode: input.framingMode || null,
        subtitleStyle: input.subtitleStyle || null,
      },
      error: null,
      createdAt: now,
      updatedAt: now,
    };

    if (!generation.projectId) {
      record.status = "WAITING_SOURCE_ASSET";
      await this.repository.save(record);
      return record;
    }

    try {
      const result = await this.prepareAutoEdit(generation.projectId, {
        generateSubtitles: true,
        quality: input.quality,
        framingMode: input.framingMode,
        subtitleStyle: input.subtitleStyle,
      });
      record.clipId = result.clip?.id || null;
      record.status = record.clipId ? "CLIP_PREPARED" : "PREPARED";
      record.renderReady = Boolean(result.clip?.id);
      record.reusedExistingClip = result.reused === true;
      record.updatedAt = new Date().toISOString();
      await this.repository.save(record);
      return record;
    } catch (error) {
      record.status = "FAILED";
      record.error = error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000);
      record.updatedAt = new Date().toISOString();
      await this.repository.save(record);
      throw error;
    }
  }
}

function buildMediaPlan(variant) {
  return {
    aspectRatio: "9:16",
    targetWidth: 1080,
    targetHeight: 1920,
    removeUnnecessarySilence: true,
    subtitles: Array.isArray(variant.subtitles) ? variant.subtitles : [],
    storyboard: Array.isArray(variant.storyboard) ? variant.storyboard : [],
    onScreenText: Array.isArray(variant.onScreenText) ? variant.onScreenText : [],
    title: variant.title || "",
    description: variant.description || "",
    cta: variant.cta || "",
    brandOverlay: variant.brandOverlay || null,
    notes: [
      "Usar únicamente medios propios, autorizados o licenciados.",
      "No eliminar marcas de agua ni señales de propiedad de terceros.",
      "Preferir archivo fuente limpio cuando exista.",
    ],
  };
}

function snapshotBrand(brand) {
  return {
    id: brand.id,
    name: brand.name,
    logoUrl: brand.logoUrl,
    colors: brand.colors,
    fonts: brand.fonts,
    visualStyle: brand.visualStyle,
    tone: brand.tone,
    preferredCta: brand.preferredCta,
    website: brand.website,
    whatsapp: brand.whatsapp,
  };
}

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}
