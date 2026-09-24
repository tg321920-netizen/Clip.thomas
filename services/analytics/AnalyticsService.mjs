import { randomUUID } from "node:crypto";
import { PublicationService } from "../publications/PublicationService.mjs";
import { AnalyticsRepository } from "./AnalyticsRepository.mjs";

const METRICS = [
  "views",
  "likes",
  "comments",
  "shares",
  "saves",
  "watchTimeSeconds",
  "averageWatchTimeSeconds",
  "averageViewDurationSeconds",
  "followersGained",
  "impressions",
  "reach",
];

export class AnalyticsService {
  constructor(options = {}) {
    this.repository = options.repository || new AnalyticsRepository();
    this.publications = options.publications || new PublicationService();
  }

  async recordSnapshot(input = {}) {
    const publication = await this.publications.get(input.publicationId);
    if (!publication) throw new Error("Publication not found.");

    const platform = normalizePlatform(input.platform || publication.platform);
    if (platform !== publication.platform) {
      throw new Error("Analytics platform must match the publication platform.");
    }

    const capturedAt = normalizeDate(input.capturedAt || new Date().toISOString());
    const metrics = normalizeMetrics(input.metrics || {});
    const now = new Date().toISOString();

    const record = {
      id: randomUUID(),
      publicationId: publication.id,
      projectId: publication.projectId,
      clipId: publication.clipId,
      channelId: publication.channelId,
      platform,
      source: cleanText(input.source || "provider", 80),
      metrics,
      capturedAt,
      createdAt: now,
    };

    await this.repository.save(record);
    return record;
  }

  async list(filters = {}) {
    return this.repository.list(filters);
  }

  async latest(publicationId) {
    return this.repository.latestByPublication(publicationId);
  }

  async latestForPublishedPublications(filters = {}) {
    const publications = await this.publications.list({
      ...filters,
      status: "PUBLISHED",
    });

    const rows = await Promise.all(
      publications.map(async (publication) => ({
        publication,
        analytics: await this.repository.latestByPublication(publication.id),
      })),
    );

    return rows;
  }

  async summarize(filters = {}) {
    const rows = await this.latestForPublishedPublications(filters);
    const withAnalytics = rows.filter((row) => row.analytics);
    const totals = Object.fromEntries(METRICS.map((metric) => [metric, 0]));

    for (const row of withAnalytics) {
      for (const metric of METRICS) {
        const value = row.analytics.metrics?.[metric];
        if (Number.isFinite(value)) totals[metric] += value;
      }
    }

    const views = totals.views || 0;
    const engagements =
      (totals.likes || 0) +
      (totals.comments || 0) +
      (totals.shares || 0) +
      (totals.saves || 0);

    return {
      publishedCount: rows.length,
      measuredCount: withAnalytics.length,
      totals,
      engagementRate: views > 0 ? engagements / views : null,
      coverage: rows.length > 0 ? withAnalytics.length / rows.length : 0,
    };
  }
}

export function normalizeMetrics(input = {}) {
  const output = {};

  for (const metric of METRICS) {
    if (!Object.hasOwn(input, metric)) continue;
    const value = Number(input[metric]);
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`${metric} must be a non-negative number.`);
    }
    output[metric] = value;
  }

  return output;
}

function normalizePlatform(value) {
  const platform = String(value || "").trim().toUpperCase();
  if (!["TIKTOK", "YOUTUBE", "FACEBOOK"].includes(platform)) {
    throw new Error("Unsupported analytics platform.");
  }
  return platform;
}

function normalizeDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("capturedAt is invalid.");
  return date.toISOString();
}

function cleanText(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
