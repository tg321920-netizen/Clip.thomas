import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "../../lib/project-id.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

const PLATFORMS = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const METRICS = [
  "views",
  "likes",
  "comments",
  "shares",
  "watchTimeSeconds",
  "averageViewDurationSeconds",
  "retentionPercent",
  "followersGained",
];

export class AnalyticsService {
  async record(input = {}) {
    const publicationId = requireUuid(input.publicationId, "publicationId");
    const platform = String(input.platform || "").trim().toUpperCase();
    if (!PLATFORMS.has(platform)) throw new Error("Invalid analytics platform.");

    const metrics = {};
    for (const key of METRICS) {
      metrics[key] = normalizeMetric(input.metrics?.[key], key);
    }
    if (
      metrics.retentionPercent !== null &&
      metrics.retentionPercent > 100
    ) {
      throw new Error("retentionPercent must be between 0 and 100.");
    }

    const capturedAt = input.capturedAt ? new Date(input.capturedAt) : new Date();
    if (!Number.isFinite(capturedAt.getTime())) throw new Error("Invalid capturedAt.");

    const record = {
      id: randomUUID(),
      publicationId,
      platform,
      metrics,
      provider: cleanText(input.provider, 80) || platform.toLowerCase(),
      capturedAt: capturedAt.toISOString(),
      createdAt: new Date().toISOString(),
    };

    await this.#save(record);
    return record;
  }

  async list(filters = {}) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const rows = await Promise.all(
      names
        .filter((name) => name.endsWith(".json"))
        .map(async (name) => {
          try {
            return JSON.parse(await readFile(path.join(directory, name), "utf8"));
          } catch {
            return null;
          }
        }),
    );

    return rows
      .filter(Boolean)
      .filter((row) => !filters.publicationId || row.publicationId === filters.publicationId)
      .filter(
        (row) =>
          !filters.platform ||
          row.platform === String(filters.platform).trim().toUpperCase(),
      )
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  }

  async latest(publicationId) {
    const rows = await this.list({
      publicationId: requireUuid(publicationId, "publicationId"),
    });
    return rows.at(-1) || null;
  }

  async #save(record) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${record.id}.json`);
    const temp = path.join(
      directory,
      `.${record.id}.${process.pid}.${Date.now()}.tmp`,
    );

    await writeFile(temp, JSON.stringify(record, null, 2), {
      encoding: "utf8",
      flag: "wx",
    });
    try {
      await rename(temp, target);
    } catch (error) {
      await rm(temp, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  #directory() {
    return path.join(getStorageRoot(), "analytics");
  }
}

export function normalizeAnalyticsMetrics(input = {}) {
  const metrics = {};
  for (const key of METRICS) metrics[key] = normalizeMetric(input?.[key], key);
  if (metrics.retentionPercent !== null && metrics.retentionPercent > 100) {
    throw new Error("retentionPercent must be between 0 and 100.");
  }
  return metrics;
}

function normalizeMetric(value, key) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`Invalid analytics metric: ${key}.`);
  }
  return number;
}

function requireUuid(value, name) {
  if (!isProjectId(value)) throw new Error(`Invalid ${name}.`);
  return value;
}

function cleanText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
