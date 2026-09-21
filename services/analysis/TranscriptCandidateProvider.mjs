import { scoreCandidate } from "./ViralScoreService.mjs";

const DEFAULTS = {
  minDuration: 15,
  maxDuration: 60,
  targetDuration: 30,
  maxCandidates: 10,
};

export class TranscriptCandidateProvider {
  constructor(options = {}) {
    this.name = "transcript-heuristic-v1";
    this.options = normalizeAnalysisOptions(options);
  }

  async analyze({ transcript, options = {} }) {
    const config = normalizeAnalysisOptions({ ...this.options, ...options });
    const segments = normalizeSegments(transcript?.segments);

    if (segments.length === 0) {
      throw new Error("A completed transcript with valid segments is required.");
    }

    const windows = buildWindows(segments, config);
    const scored = windows
      .map((window) => {
        const scoring = scoreCandidate(window);
        return {
          ...window,
          ...scoring,
          title: makeTitle(window.text),
          hook: makeHook(window.text),
          reason: scoring.reasons.join(" "),
          status: "CANDIDATE",
          analysisMethod: this.name,
        };
      })
      .sort(
        (a, b) =>
          b.viralScore - a.viralScore ||
          Math.abs(a.duration - config.targetDuration) -
            Math.abs(b.duration - config.targetDuration) ||
          a.startTime - b.startTime,
      );

    return dedupe(scored, config.maxCandidates);
  }
}

export function normalizeAnalysisOptions(options = {}) {
  const minDuration = boundedNumber(
    options.minDuration,
    5,
    120,
    DEFAULTS.minDuration,
  );
  const maxDuration = boundedNumber(
    options.maxDuration,
    minDuration,
    180,
    Math.max(DEFAULTS.maxDuration, minDuration),
  );

  return {
    minDuration,
    maxDuration,
    targetDuration: boundedNumber(
      options.targetDuration,
      minDuration,
      maxDuration,
      Math.min(Math.max(DEFAULTS.targetDuration, minDuration), maxDuration),
    ),
    maxCandidates: Math.round(
      boundedNumber(options.maxCandidates, 1, 30, DEFAULTS.maxCandidates),
    ),
  };
}

function buildWindows(segments, config) {
  const windows = [];

  for (let startIndex = 0; startIndex < segments.length; startIndex += 1) {
    const start = segments[startIndex].startTime;
    let best = null;

    for (let endIndex = startIndex; endIndex < segments.length; endIndex += 1) {
      const end = segments[endIndex].endTime;
      const duration = end - start;

      if (duration > config.maxDuration) break;
      if (duration < config.minDuration) continue;

      const text = segments
        .slice(startIndex, endIndex + 1)
        .map((segment) => segment.text)
        .join(" ")
        .trim();

      if (!text) continue;

      const targetDistance = Math.abs(duration - config.targetDuration);
      const current = {
        startTime: round(start),
        endTime: round(end),
        duration: round(duration),
        text,
        segmentStartIndex: startIndex,
        segmentEndIndex: endIndex,
        targetDistance,
      };

      if (!best || current.targetDistance < best.targetDistance) best = current;

      if (
        /[.!?…]["'»”)]?$/.test(text) &&
        targetDistance <= Math.max(8, config.targetDuration * 0.35)
      ) {
        windows.push(current);
      }
    }

    if (best) windows.push(best);
  }

  if (windows.length === 0) {
    const first = segments[0];
    const last = segments[segments.length - 1];
    const duration = last.endTime - first.startTime;

    if (duration > 0) {
      windows.push({
        startTime: round(first.startTime),
        endTime: round(last.endTime),
        duration: round(duration),
        text: segments.map((segment) => segment.text).join(" ").trim(),
        segmentStartIndex: 0,
        segmentEndIndex: segments.length - 1,
        targetDistance: Math.abs(duration - config.targetDuration),
      });
    }
  }

  return windows;
}

function dedupe(candidates, maxCandidates) {
  const selected = [];

  for (const candidate of candidates) {
    const tooSimilar = selected.some(
      (existing) => overlapRatio(existing, candidate) >= 0.72,
    );

    if (tooSimilar) continue;

    selected.push({
      id: `candidate-${String(selected.length + 1).padStart(4, "0")}`,
      ...omitInternal(candidate),
    });

    if (selected.length >= maxCandidates) break;
  }

  return selected;
}

function overlapRatio(a, b) {
  const overlap = Math.max(
    0,
    Math.min(a.endTime, b.endTime) - Math.max(a.startTime, b.startTime),
  );
  const shortest = Math.min(a.duration, b.duration);
  return shortest > 0 ? overlap / shortest : 0;
}

function makeTitle(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?…])\s+/)[0] || clean;
  const words = firstSentence.split(" ").filter(Boolean);
  const title = words.slice(0, 10).join(" ");
  return title.length > 90 ? `${title.slice(0, 87)}…` : title;
}

function makeHook(text) {
  const clean = text.replace(/\s+/g, " ").trim();
  const sentence = clean.split(/(?<=[.!?…])\s+/)[0] || clean;
  return sentence.length > 160 ? `${sentence.slice(0, 157)}…` : sentence;
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];

  return segments
    .map((segment) => ({
      startTime: Number(segment?.startTime),
      endTime: Number(segment?.endTime),
      text: String(segment?.text || "").trim(),
    }))
    .filter(
      (segment) =>
        Number.isFinite(segment.startTime) &&
        Number.isFinite(segment.endTime) &&
        segment.endTime > segment.startTime &&
        segment.text.length > 0,
    )
    .sort((a, b) => a.startTime - b.startTime);
}

function boundedNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function omitInternal(candidate) {
  const {
    targetDistance: _targetDistance,
    segmentStartIndex: _segmentStartIndex,
    segmentEndIndex: _segmentEndIndex,
    ...publicCandidate
  } = candidate;
  return publicCandidate;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
