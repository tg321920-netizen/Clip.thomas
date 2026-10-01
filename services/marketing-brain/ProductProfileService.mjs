import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

const PLATFORMS = new Set(["TIKTOK", "FACEBOOK", "YOUTUBE"]);

export class ProductProfileService {
  async create(input = {}) {
    const now = new Date().toISOString();
    const record = normalizeProfile({
      ...input,
      id: randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    await save(record);
    return record;
  }

  async get(productId) {
    assertId(productId);
    try {
      return JSON.parse(await readFile(filePath(productId), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async list(filters = {}) {
    await mkdir(directory(), { recursive: true });
    const names = await readdir(directory());
    const rows = await Promise.all(
      names.filter((name) => name.endsWith(".json")).map(async (name) => {
        try {
          return JSON.parse(await readFile(path.join(directory(), name), "utf8"));
        } catch {
          return null;
        }
      }),
    );

    return rows
      .filter(Boolean)
      .filter((row) => !filters.country || row.country === clean(filters.country, 120))
      .filter((row) => typeof filters.active !== "boolean" || row.active === filters.active)
      .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
  }

  async update(productId, input = {}) {
    const current = await this.get(productId);
    if (!current) throw new Error("Product profile not found.");
    const updated = normalizeProfile({
      ...current,
      ...input,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: new Date().toISOString(),
    });
    await save(updated);
    return updated;
  }
}

export function normalizeProductProfile(input = {}) {
  return normalizeProfile(input);
}

function normalizeProfile(input) {
  const id = String(input.id || "").trim();
  assertId(id);
  const name = clean(input.name, 160);
  if (!name) throw new Error("Product name is required.");

  return {
    id,
    name,
    description: clean(input.description, 3000) || null,
    audience: clean(input.audience, 1200) || null,
    country: clean(input.country, 120) || null,
    branding: normalizeBranding(input.branding),
    cta: clean(input.cta, 500) || null,
    frequency: normalizeFrequency(input.frequency),
    platforms: normalizePlatforms(input.platforms),
    objectives: normalizeTextList(input.objectives, 20, 200),
    active: input.active !== false,
    createdAt: normalizeDate(input.createdAt),
    updatedAt: normalizeDate(input.updatedAt),
  };
}

function normalizeBranding(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    brandName: clean(input.brandName, 160) || null,
    tone: clean(input.tone, 500) || null,
    logoAssetId: clean(input.logoAssetId, 160) || null,
    colors: normalizeTextList(input.colors, 12, 40),
    notes: clean(input.notes, 1200) || null,
  };
}

function normalizeFrequency(value) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const postsPerDay = boundedInteger(input.postsPerDay, 0, 50, 0);
  const preferredTimes = Array.isArray(input.preferredTimes)
    ? [...new Set(input.preferredTimes.map(String).map((item) => item.trim()).filter((item) =>
        /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(item),
      ))].slice(0, 20)
    : [];
  return { postsPerDay, preferredTimes };
}

function normalizePlatforms(value) {
  const input = Array.isArray(value) ? value : [];
  const output = [];
  for (const item of input) {
    const platform = String(item || "").trim().toUpperCase();
    if (!PLATFORMS.has(platform)) throw new Error(`Unsupported product platform: ${platform || "empty"}.`);
    if (!output.includes(platform)) output.push(platform);
  }
  return output;
}

function normalizeTextList(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

async function save(record) {
  await mkdir(directory(), { recursive: true });
  const target = filePath(record.id);
  const temp = path.join(directory(), `.${record.id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function directory() {
  return path.join(getStorageRoot(), "marketing", "products");
}

function filePath(id) {
  return path.join(directory(), `${id}.json`);
}

function assertId(value) {
  if (!isProjectId(String(value || ""))) throw new Error("Invalid product profile id.");
}

function clean(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeDate(value) {
  const date = new Date(value || Date.now());
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid product profile date.");
  return date.toISOString();
}

function boundedInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(min, Math.min(max, number)));
}
