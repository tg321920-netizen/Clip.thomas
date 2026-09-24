import { loadProjectFile } from "../../lib/project-files.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";
import { AnalyticsService } from "./AnalyticsService.mjs";

export class PerformanceAnalyzer {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
    this.analytics = options.analytics || new AnalyticsService({ publications: this.publications });
  }

  async analyze(filters = {}) {
    const publications = await this.publications.list({
      ...filters,
      status: "PUBLISHED",
    });

    const samples = [];
    for (const publication of publications) {
      const snapshot = await this.analytics.latest(publication.id);
      if (!snapshot) continue;

      const project = await loadProjectFile(publication.projectId);
      const clip = Array.isArray(project?.clips)
        ? project.clips.find((entry) => entry.id === publication.clipId)
        : null;

      samples.push(buildSample(publication, clip, snapshot));
    }

    const byPlatform = groupSummary(samples, (sample) => sample.platform);
    const byDuration = groupSummary(samples, (sample) => durationBucket(sample.durationSeconds));
    const bySubtitleStyle = groupSummary(
      samples.filter((sample) => sample.subtitleStyle),
      (sample) => sample.subtitleStyle,
    );

    const recommendations = [
      durationRecommendation(byDuration),
      subtitleRecommendation(bySubtitleStyle),
      coverageRecommendation(publications.length, samples.length),
    ].filter(Boolean);

    return {
      generatedAt: new Date().toISOString(),
      publicationCount: publications.length,
      measuredCount: samples.length,
      sampleNotice:
        samples.length < 4
          ? "Aún hay poca muestra. Las recomendaciones se mantienen conservadoras hasta tener más publicaciones medidas."
          : null,
      byPlatform,
      byDuration,
      bySubtitleStyle,
      recommendations,
    };
  }
}

function buildSample(publication, clip, snapshot) {
  const metrics = snapshot.metrics || {};
  const views = finite(metrics.views);
  const engagements =
    finite(metrics.likes) +
    finite(metrics.comments) +
    finite(metrics.shares) +
    finite(metrics.saves);

  return {
    publicationId: publication.id,
    platform: publication.platform,
    durationSeconds: finiteOrNull(clip?.duration),
    subtitleStyle: cleanOptional(
      clip?.subtitles?.style || clip?.autoEdit?.subtitleStyle || null,
    ),
    views,
    engagements,
    engagementRate: views > 0 ? engagements / views : null,
    averageWatchTimeSeconds: finiteOrNull(
      metrics.averageWatchTimeSeconds ?? metrics.averageViewDurationSeconds,
    ),
    capturedAt: snapshot.capturedAt,
  };
}

function groupSummary(samples, keyFn) {
  const groups = new Map();

  for (const sample of samples) {
    const key = keyFn(sample);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(sample);
    groups.set(key, list);
  }

  return [...groups.entries()]
    .map(([key, list]) => {
      const views = list.map((item) => item.views).filter(Number.isFinite);
      const engagementRates = list
        .map((item) => item.engagementRate)
        .filter(Number.isFinite);
      const watchTimes = list
        .map((item) => item.averageWatchTimeSeconds)
        .filter(Number.isFinite);

      return {
        key,
        samples: list.length,
        totalViews: sum(views),
        averageViews: average(views),
        averageEngagementRate: averageOrNull(engagementRates),
        averageWatchTimeSeconds: averageOrNull(watchTimes),
      };
    })
    .sort((a, b) => b.samples - a.samples || b.totalViews - a.totalViews);
}

function durationRecommendation(groups) {
  const eligible = groups.filter((group) => group.samples >= 2 && group.averageViews > 0);
  if (eligible.length < 2) return null;

  const best = [...eligible].sort((a, b) => b.averageViews - a.averageViews)[0];
  const baseline = average(eligible.map((group) => group.averageViews));
  if (!(best.averageViews > baseline * 1.15)) return null;

  return {
    type: "DURATION_EVIDENCE",
    message: `Los clips ${durationLabel(best.key)} están promediando más vistas en la muestra actual. Conviene probar más clips de ese rango, sin cambiar la estrategia automáticamente.`,
    evidence: {
      bucket: best.key,
      samples: best.samples,
      averageViews: Math.round(best.averageViews),
      comparisonAverageViews: Math.round(baseline),
    },
  };
}

function subtitleRecommendation(groups) {
  const eligible = groups.filter((group) => group.samples >= 2 && group.averageViews > 0);
  if (eligible.length < 2) return null;

  const best = [...eligible].sort((a, b) => b.averageViews - a.averageViews)[0];
  const baseline = average(eligible.map((group) => group.averageViews));
  if (!(best.averageViews > baseline * 1.15)) return null;

  return {
    type: "SUBTITLE_STYLE_EVIDENCE",
    message: `El estilo de subtítulos ${best.key} muestra mejor promedio de vistas en la muestra disponible. Úsalo como hipótesis de prueba, no como regla automática.`,
    evidence: {
      style: best.key,
      samples: best.samples,
      averageViews: Math.round(best.averageViews),
      comparisonAverageViews: Math.round(baseline),
    },
  };
}

function coverageRecommendation(publicationCount, measuredCount) {
  if (publicationCount === 0 || measuredCount / publicationCount >= 0.7) return null;
  return {
    type: "ANALYTICS_COVERAGE",
    message: "Faltan métricas en varias publicaciones. Mejora la cobertura de Analytics antes de permitir que el aprendizaje cambie decisiones del Autopilot.",
    evidence: {
      publicationCount,
      measuredCount,
      coverage: measuredCount / publicationCount,
    },
  };
}

function durationBucket(value) {
  if (!Number.isFinite(value)) return null;
  if (value <= 25) return "SHORT_0_25";
  if (value <= 45) return "MID_26_45";
  return "LONG_46_PLUS";
}

function durationLabel(key) {
  if (key === "SHORT_0_25") return "de hasta 25 segundos";
  if (key === "MID_26_45") return "de 26 a 45 segundos";
  return "de más de 45 segundos";
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function average(values) {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function averageOrNull(values) {
  return values.length > 0 ? average(values) : null;
}

function cleanOptional(value) {
  const text = String(value || "").trim().toUpperCase();
  return text || null;
}
