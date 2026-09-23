const DEFAULT_WEIGHTS = Object.freeze({
  completionRate: 0.35,
  engagementRate: 0.25,
  shareRate: 0.2,
  saveRate: 0.1,
  followerConversionRate: 0.1,
});

export class PerformanceAnalyzer {
  constructor({ weights = DEFAULT_WEIGHTS } = {}) {
    this.weights = normalizeWeights(weights);
  }

  analyze(sample) {
    const metrics = normalizeSample(sample);
    const components = {
      completionRate: clamp01(metrics.completionRate),
      engagementRate: clamp01(metrics.engagementRate),
      shareRate: clamp01(metrics.shareRate * 20),
      saveRate: clamp01(metrics.saveRate * 20),
      followerConversionRate: clamp01(metrics.followerConversionRate * 10),
    };

    const score = Math.round(
      Object.entries(this.weights).reduce(
        (total, [key, weight]) => total + components[key] * weight * 100,
        0,
      ),
    );

    return {
      score,
      tier: score >= 80 ? "EXCELLENT" : score >= 60 ? "GOOD" : score >= 40 ? "AVERAGE" : "WEAK",
      metrics,
      components,
      signals: buildSignals(metrics),
    };
  }

  rank(samples = []) {
    if (!Array.isArray(samples)) throw new Error("samples must be an array.");
    return samples
      .map((sample) => ({ sample, analysis: this.analyze(sample) }))
      .sort((a, b) => b.analysis.score - a.analysis.score);
  }
}

function normalizeSample(sample) {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    throw new Error("A performance sample is required.");
  }

  const views = metric(sample.views, "views");
  const likes = metric(sample.likes, "likes");
  const comments = metric(sample.comments, "comments");
  const shares = metric(sample.shares, "shares");
  const saves = metric(sample.saves, "saves");
  const followersGained = metric(sample.followersGained, "followersGained");
  const averageWatchSeconds = metric(sample.averageWatchSeconds, "averageWatchSeconds");
  const durationSeconds = metric(sample.durationSeconds, "durationSeconds");

  const denominator = Math.max(views, 1);
  return {
    views,
    likes,
    comments,
    shares,
    saves,
    followersGained,
    averageWatchSeconds,
    durationSeconds,
    completionRate: durationSeconds > 0 ? averageWatchSeconds / durationSeconds : 0,
    engagementRate: (likes + comments + shares + saves) / denominator,
    shareRate: shares / denominator,
    saveRate: saves / denominator,
    followerConversionRate: followersGained / denominator,
  };
}

function metric(value, name) {
  if (value === undefined || value === null || value === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
  return number;
}

function normalizeWeights(weights) {
  const result = {};
  let total = 0;
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    const value = Number(weights[key] ?? DEFAULT_WEIGHTS[key]);
    if (!Number.isFinite(value) || value < 0) throw new Error(`Invalid weight: ${key}.`);
    result[key] = value;
    total += value;
  }
  if (total <= 0) throw new Error("At least one performance weight must be positive.");
  for (const key of Object.keys(result)) result[key] /= total;
  return Object.freeze(result);
}

function buildSignals(metrics) {
  const signals = [];
  if (metrics.completionRate >= 0.75) signals.push("HIGH_RETENTION");
  if (metrics.engagementRate >= 0.08) signals.push("HIGH_ENGAGEMENT");
  if (metrics.shareRate >= 0.01) signals.push("HIGH_SHARE_RATE");
  if (metrics.saveRate >= 0.01) signals.push("HIGH_SAVE_RATE");
  if (metrics.followerConversionRate >= 0.005) signals.push("HIGH_FOLLOWER_CONVERSION");
  if (signals.length === 0) signals.push("NO_STRONG_SIGNAL");
  return signals;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, value));
}

export { DEFAULT_WEIGHTS };
