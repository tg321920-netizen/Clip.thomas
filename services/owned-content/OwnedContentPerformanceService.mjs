import { loadProjectFile } from "../../lib/project-files.mjs";
import { AnalyticsService } from "../analytics/AnalyticsService.mjs";
import { PerformanceAnalyzer } from "../analytics/PerformanceAnalyzer.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { ContentCostService } from "./ContentCostService.mjs";

const DIMENSIONS = ["topic", "category", "hook", "format", "language", "platform", "voiceProfile", "editStyle", "publishHour"];

export class OwnedContentPerformanceService {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
    this.analytics = options.analytics || new AnalyticsService({ publications: this.publications });
    this.baseAnalyzer = options.baseAnalyzer || new PerformanceAnalyzer({ publications: this.publications, analytics: this.analytics });
    this.costs = options.costs || new ContentCostService();
  }

  async analyze(filters = {}) {
    const base = await this.baseAnalyzer.analyze(filters);
    const publications = await this.publications.list({ ...filters, status: "PUBLISHED" });
    const samples = [];
    for (const publication of publications) {
      const snapshot = await this.analytics.latest(publication.id);
      if (!snapshot) continue;
      const project = await loadProjectFile(publication.projectId);
      const meta = project?.ownedContent;
      if (!meta || meta.channelId !== publication.channelId) continue;
      const metrics = snapshot.metrics || {};
      const views = finite(metrics.views);
      const engagements = finite(metrics.likes) + finite(metrics.comments) + finite(metrics.shares) + finite(metrics.saves);
      const costRows = await this.costs.list({ channelId: publication.channelId, contentId: publication.projectId });
      const knownCostRows = costRows.filter((row) => Number.isFinite(row.amountUsd));
      const knownCostUsd = knownCostRows.reduce((sum, row) => sum + row.amountUsd, 0);
      samples.push({
        publicationId: publication.id,
        projectId: publication.projectId,
        views,
        engagementRate: views > 0 ? engagements / views : null,
        averageWatchTimeSeconds: finiteOrNull(metrics.averageWatchTimeSeconds ?? metrics.averageViewDurationSeconds),
        knownCostUsd,
        unpricedCostRecords: costRows.length - knownCostRows.length,
        viewsPerDollar: knownCostUsd > 0 ? views / knownCostUsd : null,
        topic: meta.topic || null,
        category: meta.category || null,
        hook: meta.hook || null,
        format: meta.format || null,
        language: meta.language || null,
        platform: publication.platform,
        voiceProfile: meta.voiceProfile || null,
        editStyle: meta.editStyle || null,
        publishHour: publication.publishedAt ? new Date(publication.publishedAt).getUTCHours().toString().padStart(2, "0") : null,
      });
    }

    const dimensions = {};
    for (const dimension of DIMENSIONS) dimensions[dimension] = summarize(samples, dimension);
    const knownCostUsd = samples.reduce((sum, sample) => sum + sample.knownCostUsd, 0);
    const totalViews = samples.reduce((sum, sample) => sum + sample.views, 0);
    return {
      ...base,
      ownedContentSampleCount: samples.length,
      costSummary: {
        knownCostUsd,
        unpricedRecords: samples.reduce((sum, sample) => sum + sample.unpricedCostRecords, 0),
        viewsPerDollar: knownCostUsd > 0 ? totalViews / knownCostUsd : null,
        note: "Cost efficiency uses only recorded costs. Unknown provider prices are never estimated automatically.",
      },
      dimensions,
      learningPolicy: "Evidence is descriptive. Small samples never change channel rules automatically.",
    };
  }
}

function summarize(samples, key) {
  const groups = new Map();
  for (const sample of samples) {
    const value = sample[key];
    if (!value) continue;
    const normalized = String(value).slice(0, key === "hook" || key === "topic" ? 160 : 80);
    const list = groups.get(normalized) || [];
    list.push(sample);
    groups.set(normalized, list);
  }
  return [...groups.entries()].map(([value, list]) => {
    const knownCostUsd = list.reduce((sum, item) => sum + item.knownCostUsd, 0);
    const totalViews = list.reduce((sum, item) => sum + item.views, 0);
    return {
      value,
      samples: list.length,
      totalViews,
      averageViews: list.length ? totalViews / list.length : 0,
      averageEngagementRate: averageNullable(list.map((item) => item.engagementRate)),
      averageWatchTimeSeconds: averageNullable(list.map((item) => item.averageWatchTimeSeconds)),
      knownCostUsd,
      viewsPerDollar: knownCostUsd > 0 ? totalViews / knownCostUsd : null,
      unpricedCostRecords: list.reduce((sum, item) => sum + item.unpricedCostRecords, 0),
    };
  }).sort((a, b) => b.samples - a.samples || b.totalViews - a.totalViews);
}
function finite(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : 0; }
function finiteOrNull(value) { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
function averageNullable(values) { const clean = values.filter(Number.isFinite); return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null; }
