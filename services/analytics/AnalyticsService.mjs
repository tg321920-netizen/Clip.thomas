import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getStorageRoot } from "../../lib/storage-paths.mjs";

const PLATFORMS = new Set(["TIKTOK", "YOUTUBE", "FACEBOOK"]);
const METRICS = ["views", "likes", "comments", "shares", "watchTime", "retention", "followersGained"];

export class AnalyticsService {
  async record(input) {
    const publicationId = cleanId(input?.publicationId, "publicationId");
    const platform = String(input?.platform || "").toUpperCase();
    if (!PLATFORMS.has(platform)) throw new Error("Invalid analytics platform.");

    const metrics = {};
    for (const key of METRICS) {
      const value = Number(input?.metrics?.[key] ?? 0);
      if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid analytics metric: ${key}.`);
      metrics[key] = value;
    }
    if (metrics.retention > 100) throw new Error("Retention must be between 0 and 100.");

    const capturedAt = input?.capturedAt ? new Date(input.capturedAt) : new Date();
    if (Number.isNaN(capturedAt.getTime())) throw new Error("Invalid capturedAt.");

    const record = {
      id: randomUUID(), publicationId, platform, metrics,
      capturedAt: capturedAt.toISOString(), createdAt: new Date().toISOString(),
    };
    await this.#save(record);
    return record;
  }

  async list(filters = {}) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const names = await readdir(directory);
    const rows = await Promise.all(names.filter((name) => name.endsWith(".json")).map(async (name) => {
      try { return JSON.parse(await readFile(path.join(directory, name), "utf8")); } catch { return null; }
    }));
    return rows.filter(Boolean)
      .filter((row) => !filters.publicationId || row.publicationId === filters.publicationId)
      .filter((row) => !filters.platform || row.platform === String(filters.platform).toUpperCase())
      .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  }

  async latest(publicationId) {
    const rows = await this.list({ publicationId: cleanId(publicationId, "publicationId") });
    return rows.at(-1) || null;
  }

  async #save(record) {
    const directory = this.#directory();
    await mkdir(directory, { recursive: true });
    const target = path.join(directory, `${record.id}.json`);
    const temp = path.join(directory, `.${record.id}.${process.pid}.${Date.now()}.tmp`);
    await writeFile(temp, JSON.stringify(record, null, 2), { encoding: "utf8", flag: "wx" });
    try { await rename(temp, target); }
    catch (error) { await rm(temp, { force: true }).catch(() => undefined); throw error; }
  }

  #directory() { return path.join(getStorageRoot(), "analytics"); }
}

function cleanId(value, name) {
  const result = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(result)) throw new Error(`Invalid ${name}.`);
  return result;
}
