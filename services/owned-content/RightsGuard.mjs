import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

export const RIGHTS_CLASSES = new Set([
  "OWNED",
  "LICENSED",
  "PUBLIC_DOMAIN",
  "PERMITTED_OFFICIAL_SOURCE",
  "THIRD_PARTY_UNKNOWN",
]);
const MEDIA_TYPES = new Set(["IMAGE", "VIDEO", "AUDIO", "MUSIC", "SFX", "GRAPHIC"]);

export class RightsGuard {
  async register(input = {}) {
    assertId(input.channelId, "channel");
    const rightsClass = normalizeClass(input.rightsClass);
    const mediaType = normalizeMediaType(input.mediaType);
    const provenance = normalizeProvenance(input.provenance);
    const assessment = assess(rightsClass, provenance);
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      channelId: input.channelId,
      contentId: optionalId(input.contentId, "content"),
      mediaType,
      rightsClass,
      localRelativePath: normalizeRelativePath(input.localRelativePath),
      topicFingerprint: clean(input.topicFingerprint, 128) || null,
      labels: normalizeList(input.labels, 30, 100),
      provenance,
      reusable: assessment.reusable,
      reviewRequired: assessment.reviewRequired,
      reasons: assessment.reasons,
      createdAt: now,
      updatedAt: now,
    };
    await save(record);
    return record;
  }

  async get(assetId) {
    assertId(assetId, "asset");
    try { return JSON.parse(await readFile(filePath(assetId), "utf8")); }
    catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async list(filters = {}) {
    await mkdir(directory(), { recursive: true });
    const names = await readdir(directory());
    const rows = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try { return JSON.parse(await readFile(path.join(directory(), name), "utf8")); } catch { return null; }
    }));
    return rows.filter(Boolean).filter((row) => {
      if (filters.channelId && row.channelId !== filters.channelId) return false;
      if (filters.contentId && row.contentId !== filters.contentId) return false;
      if (filters.rightsClass && row.rightsClass !== String(filters.rightsClass).toUpperCase()) return false;
      return true;
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async verifyAssets(assetIds = []) {
    const assets = [];
    const blocked = [];
    for (const rawId of [...new Set(assetIds.map(String))]) {
      const asset = await this.get(rawId);
      if (!asset) {
        blocked.push({ assetId: rawId, reason: "ASSET_NOT_FOUND" });
        continue;
      }
      assets.push(asset);
      if (!asset.reusable) blocked.push({ assetId: asset.id, reason: asset.reasons.join("; ") || "RIGHTS_NOT_CLEARED" });
    }
    return { assets, blocked, ready: blocked.length === 0 };
  }

  async assertUsable(assetId) {
    const asset = await this.get(assetId);
    if (!asset) throw new Error("Rights asset not found.");
    if (!asset.reusable) {
      throw new Error(`Asset cannot be reused automatically: ${asset.reasons.join("; ") || asset.rightsClass}.`);
    }
    return asset;
  }
}

export function assessRights(rightsClass, provenance = {}) {
  return assess(normalizeClass(rightsClass), normalizeProvenance(provenance));
}

function assess(rightsClass, provenance) {
  if (rightsClass === "OWNED") return { reusable: true, reviewRequired: false, reasons: [] };
  if (rightsClass === "THIRD_PARTY_UNKNOWN") {
    return { reusable: false, reviewRequired: true, reasons: ["Third-party rights are unknown; duration does not create permission."] };
  }
  if (rightsClass === "LICENSED") {
    const ok = Boolean(provenance.licenseName || provenance.licenseUrl || provenance.permissionNote);
    return { reusable: ok, reviewRequired: !ok, reasons: ok ? [] : ["Licensed assets need recorded license or permission details."] };
  }
  if (rightsClass === "PUBLIC_DOMAIN") {
    const ok = Boolean(provenance.sourceUrl && provenance.permissionNote);
    return { reusable: ok, reviewRequired: !ok, reasons: ok ? [] : ["Public-domain status needs source and basis recorded."] };
  }
  if (rightsClass === "PERMITTED_OFFICIAL_SOURCE") {
    const ok = Boolean(provenance.sourceUrl && provenance.permissionNote);
    return { reusable: ok, reviewRequired: !ok, reasons: ok ? [] : ["Official-source reuse needs the source and permission basis recorded."] };
  }
  return { reusable: false, reviewRequired: true, reasons: ["Rights classification is insufficient."] };
}

function normalizeProvenance(value = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    sourceUrl: optionalUrl(input.sourceUrl),
    owner: clean(input.owner, 180) || null,
    licenseName: clean(input.licenseName, 180) || null,
    licenseUrl: optionalUrl(input.licenseUrl),
    permissionNote: clean(input.permissionNote, 1000) || null,
    obtainedAt: normalizeDate(input.obtainedAt),
  };
}
function normalizeClass(value) { const normalized = String(value || "THIRD_PARTY_UNKNOWN").trim().toUpperCase(); if (!RIGHTS_CLASSES.has(normalized)) throw new Error("Invalid rights class."); return normalized; }
function normalizeMediaType(value) { const normalized = String(value || "").trim().toUpperCase(); if (!MEDIA_TYPES.has(normalized)) throw new Error("Invalid media type."); return normalized; }
function normalizeRelativePath(value) { const text = clean(value, 800); if (!text) return null; if (path.isAbsolute(text) || text.includes("..")) throw new Error("Asset path must be a safe storage-relative path."); return text.replaceAll("\\", "/"); }
function normalizeList(value, maxItems, maxLength) { return Array.isArray(value) ? [...new Set(value.map((item) => clean(item, maxLength)).filter(Boolean))].slice(0, maxItems) : []; }
function optionalUrl(value) { const text = clean(value, 1200); if (!text) return null; let url; try { url = new URL(text); } catch { throw new Error("Invalid provenance URL."); } if (!["http:", "https:"].includes(url.protocol)) throw new Error("Provenance URLs must use HTTP(S)."); return url.toString(); }
function optionalId(value, label) { if (value === undefined || value === null || value === "") return null; assertId(value, label); return String(value); }
function normalizeDate(value) { if (!value) return null; const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("Invalid provenance date."); return date.toISOString(); }
function clean(value, max) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }
function assertId(value, label) { if (!isProjectId(String(value || ""))) throw new Error(`Invalid ${label} id.`); }
async function save(record) { await mkdir(directory(), { recursive: true }); const target = filePath(record.id); const temp = path.join(directory(), `.${record.id}.${process.pid}.${Date.now()}.tmp`); await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" }); try { await rename(temp, target); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
function directory() { return path.join(getStorageRoot(), "owned-content", "rights"); }
function filePath(id) { return path.join(directory(), `${id}.json`); }
