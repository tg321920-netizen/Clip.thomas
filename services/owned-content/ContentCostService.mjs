import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

const CATEGORIES = new Set(["AI", "TTS", "VISUAL", "PROCESSING", "OTHER"]);

export class ContentCostService {
  async record(input = {}) {
    assertId(input.channelId, "channel");
    const amountUsd = normalizeAmount(input.amountUsd);
    const category = normalizeCategory(input.category);
    const now = normalizeDate(input.createdAt || new Date().toISOString());
    const record = {
      id: randomUUID(),
      channelId: input.channelId,
      contentId: optionalId(input.contentId, "content"),
      category,
      provider: clean(input.provider, 100) || "local",
      operation: clean(input.operation, 140) || "unknown",
      amountUsd,
      costKnown: amountUsd !== null,
      note: clean(input.note, 500) || null,
      createdAt: now,
    };
    await save(record);
    return record;
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
      if (filters.category && row.category !== String(filters.category).toUpperCase()) return false;
      if (filters.since && Date.parse(row.createdAt) < Date.parse(filters.since)) return false;
      if (filters.until && Date.parse(row.createdAt) > Date.parse(filters.until)) return false;
      return true;
    });
  }

  async budgetStatus(channelId, budget = {}, options = {}) {
    assertId(channelId, "channel");
    const now = options.now ? new Date(options.now) : new Date();
    if (!Number.isFinite(now.getTime())) throw new Error("Invalid budget clock.");
    const requestedCostUsd = Number(options.requestedCostUsd || 0);
    if (!Number.isFinite(requestedCostUsd) || requestedCostUsd < 0) throw new Error("Requested cost must be non-negative.");

    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const records = await this.list({ channelId, since: monthStart.toISOString(), until: now.toISOString() });
    const known = records.filter((row) => Number.isFinite(row.amountUsd));
    const dailySpent = known.filter((row) => Date.parse(row.createdAt) >= dayStart.getTime()).reduce((sum, row) => sum + row.amountUsd, 0);
    const monthlySpent = known.reduce((sum, row) => sum + row.amountUsd, 0);
    const limits = normalizeBudget(budget);

    const reasons = [];
    if (requestedCostUsd > limits.maxCostPerContentUsd) reasons.push("MAX_COST_PER_CONTENT");
    if (dailySpent + requestedCostUsd > limits.dailyBudgetUsd) reasons.push("DAILY_BUDGET");
    if (monthlySpent + requestedCostUsd > limits.monthlyBudgetUsd) reasons.push("MONTHLY_BUDGET");

    return {
      allowed: reasons.length === 0,
      reasons,
      limits,
      requestedCostUsd,
      dailySpentUsd: round(dailySpent),
      monthlySpentUsd: round(monthlySpent),
      unpricedRecords: records.length - known.length,
      note: records.length > known.length ? "Hay operaciones sin costo conocido; ClipForge no inventa precios para completar esos registros." : null,
    };
  }

  async assertBudget(channelId, budget, requestedCostUsd, options = {}) {
    const status = await this.budgetStatus(channelId, budget, { ...options, requestedCostUsd });
    if (!status.allowed) throw new Error(`Budget limit reached: ${status.reasons.join(", ")}. No paid capacity was authorized.`);
    return status;
  }
}

export function normalizeBudget(input = {}) {
  return {
    dailyBudgetUsd: nonNegative(input.dailyBudgetUsd, 0),
    monthlyBudgetUsd: nonNegative(input.monthlyBudgetUsd, 0),
    maxCostPerContentUsd: nonNegative(input.maxCostPerContentUsd, 0),
  };
}
function normalizeAmount(value) { if (value === null || value === undefined || value === "") return null; const n = Number(value); if (!Number.isFinite(n) || n < 0) throw new Error("amountUsd must be a non-negative number or null."); return n; }
function normalizeCategory(value) { const category = String(value || "OTHER").trim().toUpperCase(); if (!CATEGORIES.has(category)) throw new Error("Invalid content cost category."); return category; }
function nonNegative(value, fallback) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : fallback; }
function normalizeDate(value) { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error("Invalid cost date."); return date.toISOString(); }
function optionalId(value, label) { if (!value) return null; assertId(value, label); return String(value); }
function assertId(value, label) { if (!isProjectId(String(value || ""))) throw new Error(`Invalid ${label} id.`); }
function clean(value, max) { return String(value || "").replace(/\s+/g, " ").trim().slice(0, max); }
function round(value) { return Math.round(value * 10000) / 10000; }
async function save(record) { await mkdir(directory(), { recursive: true }); const target = path.join(directory(), `${record.id}.json`); const temp = path.join(directory(), `.${record.id}.${process.pid}.${Date.now()}.tmp`); await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" }); try { await rename(temp, target); } catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; } }
function directory() { return path.join(getStorageRoot(), "owned-content", "costs"); }
