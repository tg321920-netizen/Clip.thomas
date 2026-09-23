import { loadProjectFile } from "../../lib/project-files.mjs";
import { AnalyticsService } from "../analytics/AnalyticsService.mjs";
import { ChannelService } from "../channels/ChannelService.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";

export class PerformanceAnalyzer {
  constructor(options = {}) {
    this.analytics = options.analytics || new AnalyticsService();
    this.publications = options.publications || new PublicationService();
    this.channels = options.channels || new ChannelService();
  }

  async analyze(filters = {}) {
    const publications = await this.publications.list({
      status: "PUBLISHED",
      ...(filters.platform ? { platform: String(filters.platform).toUpperCase() } : {}),
      ...(filters.channelId ? { channelId: filters.channelId } : {}),
    });

    const rows = [];
    for (const publication of publications) {
      const snapshot = await this.analytics.latest(publication.id);
      if (!snapshot) continue;

      const project = await loadProjectFile(publication.projectId);
      const clip = Array.isArray(project?.clips)
        ? project.clips.find((entry) => entry.id === publication.clipId)
        : null;
      const candidate = project?.analysis?.candidates?.find(
        (entry) => entry.id === clip?.candidateId,
      );
      const channel = await this.channels.getChannel(publication.channelId);

      rows.push({
        publicationId: publication.id,
        platform: publication.platform,
        channelId: publication.channelId,
        views: numberOrNull(snapshot.metrics?.views),
        likes: numberOrNull(snapshot.metrics?.likes),
        comments: numberOrNull(snapshot.metrics?.comments),
        shares: numberOrNull(snapshot.metrics?.shares),
        retentionPercent: numberOrNull(snapshot.metrics?.retentionPercent),
        duration: numberOrNull(clip?.duration),
        viralScore: numberOrNull(candidate?.viralScore),
        subtitleStyle: clip?.edit?.subtitleStyle || clip?.autoEdit?.subtitleStyle || null,
        framingMode: clip?.edit?.framingMode || clip?.autoEdit?.framingMode || null,
        localHour: getLocalHour(publication.scheduledAt || publication.publishedAt, channel?.timezone),
        capturedAt: snapshot.capturedAt,
      });
    }

    const observations = buildObservations(rows);
    const recommendations = buildRecommendations(rows, observations);

    return {
      generatedAt: new Date().toISOString(),
      filters: {
        platform: filters.platform ? String(filters.platform).toUpperCase() : null,
        channelId: filters.channelId || null,
      },
      sampleCount: rows.length,
      observations,
      recommendations,
      disclaimer:
        "Estas recomendaciones describen patrones de las métricas disponibles. No garantizan rendimiento y no cambian parámetros automáticamente.",
    };
  }
}

export function buildObservations(rows) {
  return {
    duration: summarizeGroups(rows, durationBucket),
    viralScore: summarizeGroups(rows, viralScoreBucket),
    subtitleStyle: summarizeGroups(rows, (row) => row.subtitleStyle || "UNKNOWN"),
    framingMode: summarizeGroups(rows, (row) => row.framingMode || "UNKNOWN"),
    postingWindow: summarizeGroups(rows, (row) => hourBucket(row.localHour)),
  };
}

export function buildRecommendations(rows, observations) {
  if (rows.length < 3) {
    return [
      {
        id: "MORE_DATA",
        type: "DATA_QUALITY",
        confidence: "LOW",
        text: "Recopila métricas de al menos 3 publicaciones antes de ajustar la estrategia.",
        evidence: { sampleCount: rows.length },
        autoApply: false,
      },
    ];
  }

  const output = [];
  addGroupRecommendation(output, "DURATION", observations.duration, "duración");
  addGroupRecommendation(output, "VIRAL_SCORE", observations.viralScore, "rango de ViralScore");
  addGroupRecommendation(output, "SUBTITLE_STYLE", observations.subtitleStyle, "estilo de subtítulos");
  addGroupRecommendation(output, "FRAMING", observations.framingMode, "encuadre");
  addGroupRecommendation(output, "POSTING_WINDOW", observations.postingWindow, "franja horaria");

  if (output.length === 0) {
    output.push({
      id: "MORE_COMPARABLE_DATA",
      type: "DATA_QUALITY",
      confidence: "LOW",
      text: "Hay métricas, pero todavía no existen grupos comparables con suficiente evidencia para proponer un ajuste.",
      evidence: { sampleCount: rows.length },
      autoApply: false,
    });
  }

  return output;
}

function addGroupRecommendation(output, type, groups, label) {
  const comparable = groups.filter(
    (group) => group.sampleCount >= 2 && group.averageViews !== null,
  );
  if (comparable.length < 2) return;

  const ordered = [...comparable].sort(
    (a, b) => b.averageViews - a.averageViews,
  );
  const leader = ordered[0];
  const runnerUp = ordered[1];
  if (!runnerUp || runnerUp.averageViews <= 0) return;

  const lift = ((leader.averageViews - runnerUp.averageViews) / runnerUp.averageViews) * 100;
  if (lift < 10) return;

  output.push({
    id: `${type}_${leader.key}`,
    type,
    confidence: leader.sampleCount >= 5 && runnerUp.sampleCount >= 5 ? "MEDIUM" : "LOW",
    text: `Prueba más contenido con ${label} “${leader.key}”; en la muestra actual promedia ${Math.round(lift)}% más vistas que el siguiente grupo comparable.`,
    evidence: {
      group: leader.key,
      sampleCount: leader.sampleCount,
      averageViews: leader.averageViews,
      comparedWith: runnerUp.key,
      comparedSampleCount: runnerUp.sampleCount,
      comparedAverageViews: runnerUp.averageViews,
      liftPercent: round(lift, 1),
    },
    autoApply: false,
  });
}

function summarizeGroups(rows, selector) {
  const buckets = new Map();
  for (const row of rows) {
    const key = selector(row);
    if (!key) continue;
    const bucket = buckets.get(key) || [];
    bucket.push(row);
    buckets.set(key, bucket);
  }

  return [...buckets.entries()]
    .map(([key, values]) => ({
      key,
      sampleCount: values.length,
      averageViews: average(values.map((row) => row.views)),
      averageEngagementRate: average(
        values.map((row) => engagementRate(row)),
      ),
      averageRetentionPercent: average(
        values.map((row) => row.retentionPercent),
      ),
    }))
    .sort((a, b) => b.sampleCount - a.sampleCount || a.key.localeCompare(b.key));
}

function engagementRate(row) {
  if (row.views === null || row.views <= 0) return null;
  const interactions = [row.likes, row.comments, row.shares]
    .filter((value) => value !== null)
    .reduce((sum, value) => sum + value, 0);
  return round((interactions / row.views) * 100, 3);
}

function durationBucket(row) {
  if (row.duration === null) return null;
  if (row.duration < 20) return "<20s";
  if (row.duration <= 40) return "20-40s";
  return ">40s";
}

function viralScoreBucket(row) {
  if (row.viralScore === null) return null;
  if (row.viralScore < 60) return "<60";
  if (row.viralScore < 80) return "60-79";
  return "80+";
}

function hourBucket(hour) {
  if (!Number.isInteger(hour)) return null;
  if (hour < 6) return "00-05";
  if (hour < 12) return "06-11";
  if (hour < 18) return "12-17";
  return "18-23";
}

function getLocalHour(value, timezone) {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || "UTC",
      hour: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date);
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    return Number.isInteger(hour) ? hour : null;
  } catch {
    return null;
  }
}

function average(values) {
  const valid = values.filter((value) => Number.isFinite(value));
  if (valid.length === 0) return null;
  return round(valid.reduce((sum, value) => sum + value, 0) / valid.length, 3);
}

function numberOrNull(value) {
  const number = Number(value);
  return value === null || value === undefined || !Number.isFinite(number)
    ? null
    : number;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
