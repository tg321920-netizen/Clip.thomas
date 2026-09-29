import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

const STATES = new Set(["LOW", "RISING", "VIRAL", "SATURATED"]);

export class TrendHunterService {
  async ingest(input = {}, profile = {}) {
    assertId(input.channelId, "channel");
    const topic = clean(input.topic, 240);
    if (!topic) throw new Error("Trend topic is required.");

    const sourceCount = bounded(input.sourceCount, 0, 100, 0);
    const relevance = scoreRelevance(topic, profile, input.relevanceScore);
    const recency = scoreRecency(input.observedAt || new Date().toISOString());
    const growth = bounded(input.growthScore ?? input.velocityScore, 0, 100, 0);
    const saturation = bounded(input.saturationScore, 0, 100, 0);
    const originality = bounded(input.originalityPotential, 0, 100, 50);
    const historyFit = bounded(input.historyFitScore, 0, 100, 50);
    const sourceAvailability = Math.min(100, sourceCount * 24);

    const score = Math.round(
      relevance * 0.24 +
      recency * 0.18 +
      growth * 0.22 +
      sourceAvailability * 0.14 +
      originality * 0.14 +
      historyFit * 0.08 -
      saturation * 0.18,
    );

    const state = classify({ score, saturation, sourceCount, growth });
    const now = new Date().toISOString();
    const record = {
      id: randomUUID(),
      channelId: input.channelId,
      topic,
      category: clean(input.category, 100) || "GENERAL",
      state,
      score: Math.max(0, Math.min(100, score)),
      signals: {
        relevance,
        recency,
        growth,
        saturation,
        sourceAvailability,
        sourceCount,
        originalityPotential: originality,
        historyFit,
      },
      sourceSignals: normalizeSourceSignals(input.sourceSignals),
      requiresHumanSelection: true,
      selectedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await save(record);
    return record;
  }

  async get(id) {
    assertId(id, "trend");
    try {
      return JSON.parse(await readFile(filePath(id), "utf8"));
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  async list(filters = {}) {
    await mkdir(directory(), { recursive: true });
    const names = await readdir(directory());
    const rows = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try { return JSON.parse(await readFile(path.join(directory(), name), "utf8")); }
      catch { return null; }
    }));
    return rows.filter(Boolean).filter((row) => {
      if (filters.channelId && row.channelId !== filters.channelId) return false;
      if (filters.state && row.state !== String(filters.state).toUpperCase()) return false;
      return true;
    }).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  }

  async select(id) {
    const current = await this.get(id);
    if (!current) throw new Error("Trend not found.");
    const updated = { ...current, selectedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    await save(updated);
    return updated;
  }
}

export function classifyTrend(input = {}) {
  const state = classify(input);
  if (!STATES.has(state)) throw new Error("Invalid trend classification.");
  return state;
}

function classify({ score = 0, saturation = 0, sourceCount = 0, growth = 0 }) {
  if (Number(saturation) >= 82 || (Number(saturation) >= 68 && Number(growth) < 30)) return "SATURATED";
  if (Number(score) >= 74 && Number(sourceCount) >= 2 && Number(growth) >= 45) return "VIRAL";
  if (Number(score) >= 48 && Number(sourceCount) >= 1) return "RISING";
  return "LOW";
}

function scoreRelevance(topic, profile, explicit) {
  if (Number.isFinite(Number(explicit))) return bounded(explicit, 0, 100, 0);
  const haystack = [profile.niche, profile.targetAudience, profile.strategyText, ...(profile.rules || [])].join(" ").toLowerCase();
  const tokens = uniqueTokens(topic);
  if (tokens.length === 0 || !haystack) return 50;
  const matched = tokens.filter((token) => haystack.includes(token)).length;
  return Math.round(35 + (matched / tokens.length) * 65);
}

function scoreRecency(value) {
  const observed = Date.parse(value);
  if (!Number.isFinite(observed)) return 35;
  const hours = Math.max(0, (Date.now() - observed) / 3_600_000);
  if (hours <= 6) return 100;
  if (hours <= 24) return 82;
  if (hours <= 72) return 58;
  if (hours <= 168) return 35;
  return 15;
}

function normalizeSourceSignals(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((item) => ({
    source: clean(item?.source, 160),
    url: clean(item?.url, 1000) || null,
    observedAt: normalizeDate(item?.observedAt),
    metric: clean(item?.metric, 80) || null,
    value: Number.isFinite(Number(item?.value)) ? Number(item.value) : null,
  }));
}

async function save(record) {
  await mkdir(directory(), { recursive: true });
  const target = filePath(record.id);
  const temp = path.join(directory(), `.${record.id}.${process.pid}.${Date.now()}.tmp`);
  await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
  try { await rename(temp, target); }
  catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
}
function directory() { return path.join(getStorageRoot(), "owned-content", "trends"); }
function filePath(id) { return path.join(directory(), `${id}.json`); }
function assertId(value, label) { if (!isProjectId(String(value || ""))) throw new Error(`Invalid ${label} id.`); }
function bounded(value, min, max, fallback) { const n = Number(value); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback; }
function clean(value, max) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }
function normalizeDate(value) { const date = new Date(value || Date.now()); return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString(); }
function uniqueTokens(value) { return [...new Set(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [])]; }
