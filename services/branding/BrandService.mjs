import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import { BrandRepository } from "./BrandRepository.mjs";

export class BrandService {
  constructor(options = {}) {
    this.repository = options.repository || new BrandRepository();
  }

  async list(filters = {}) {
    return this.repository.list({
      ...(filters.projectId ? { projectId: normalizeId(filters.projectId, "project") } : {}),
    });
  }

  async get(brandId) {
    return this.repository.get(normalizeId(brandId, "brand"));
  }

  async create(input = {}) {
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      projectId: optionalId(input.projectId, "project"),
      name: requiredText(input.name, "name", 120),
      logoUrl: optionalUrl(input.logoUrl),
      colors: normalizeColors(input.colors),
      fonts: normalizeTextArray(input.fonts, 6, 80),
      visualStyle: cleanText(input.visualStyle, 300) || null,
      tone: cleanText(input.tone, 300) || null,
      preferredCta: cleanText(input.preferredCta, 240) || null,
      website: optionalUrl(input.website),
      whatsapp: cleanText(input.whatsapp, 80) || null,
      socialLinks: normalizeUrls(input.socialLinks, 12),
      createdAt: now,
      updatedAt: now,
    };
    await this.repository.save(record);
    return record;
  }

  async update(brandId, input = {}) {
    const id = normalizeId(brandId, "brand");
    const current = await this.repository.get(id);
    if (!current) throw new Error("Brand not found.");
    const next = {
      ...current,
      ...(Object.hasOwn(input, "name") ? { name: requiredText(input.name, "name", 120) } : {}),
      ...(Object.hasOwn(input, "logoUrl") ? { logoUrl: optionalUrl(input.logoUrl) } : {}),
      ...(Object.hasOwn(input, "colors") ? { colors: normalizeColors(input.colors) } : {}),
      ...(Object.hasOwn(input, "fonts") ? { fonts: normalizeTextArray(input.fonts, 6, 80) } : {}),
      ...(Object.hasOwn(input, "visualStyle") ? { visualStyle: cleanText(input.visualStyle, 300) || null } : {}),
      ...(Object.hasOwn(input, "tone") ? { tone: cleanText(input.tone, 300) || null } : {}),
      ...(Object.hasOwn(input, "preferredCta") ? { preferredCta: cleanText(input.preferredCta, 240) || null } : {}),
      ...(Object.hasOwn(input, "website") ? { website: optionalUrl(input.website) } : {}),
      ...(Object.hasOwn(input, "whatsapp") ? { whatsapp: cleanText(input.whatsapp, 80) || null } : {}),
      ...(Object.hasOwn(input, "socialLinks") ? { socialLinks: normalizeUrls(input.socialLinks, 12) } : {}),
      updatedAt: new Date().toISOString(),
    };
    await this.repository.save(next);
    return next;
  }

  applyToVariant(brand, variant) {
    if (!brand) return { variant, brand: null };
    return {
      variant: {
        ...variant,
        cta: brand.preferredCta || variant.cta,
        brandOverlay: {
          name: brand.name,
          logoUrl: brand.logoUrl,
          colors: brand.colors,
          fonts: brand.fonts,
          visualStyle: brand.visualStyle,
          tone: brand.tone,
          website: brand.website,
          whatsapp: brand.whatsapp,
        },
      },
      brand,
    };
  }
}

function normalizeColors(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    const name = cleanText(key, 40);
    const color = cleanText(raw, 40);
    if (!name || !color) continue;
    if (!/^#?[0-9a-f]{3,8}$/i.test(color) && !/^[a-z]{3,20}$/i.test(color)) continue;
    output[name] = color.startsWith("#") ? color : color;
    if (Object.keys(output).length >= 12) break;
  }
  return output;
}

function normalizeTextArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanText(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function normalizeUrls(value, maxItems) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(optionalUrl).filter(Boolean))].slice(0, maxItems);
}

function optionalUrl(value) {
  const text = cleanText(value, 500);
  if (!text) return null;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Invalid URL.");
  }
  if (!new Set(["https:", "http:"]).has(url.protocol)) throw new Error("Only HTTP(S) URLs are allowed.");
  return url.toString();
}

function optionalId(value, label) {
  if (value === undefined || value === null || value === "") return null;
  return normalizeId(value, label);
}

function normalizeId(value, label) {
  const id = String(value || "").trim();
  if (!isProjectId(id)) throw new Error(`Invalid ${label} id.`);
  return id;
}

function requiredText(value, label, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, maxLength) : "";
}
