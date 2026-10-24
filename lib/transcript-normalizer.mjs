export function normalizeWhisperResult(payload) {
  const rawSegments = Array.isArray(payload?.segments) ? payload.segments : [];
  const segments = [];

  for (const segment of rawSegments) {
    const startTime = Number(segment?.start);
    const endTime = Number(segment?.end);
    const text = String(segment?.text ?? "").trim();

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < 0 ||
      endTime <= startTime ||
      text.length === 0
    ) {
      continue;
    }

    const words = normalizeWords(segment?.words, startTime, endTime);

    segments.push({
      id: `segment-${String(segments.length + 1).padStart(6, "0")}`,
      startTime: round(startTime, 3),
      endTime: round(endTime, 3),
      text,
      ...(words.length > 0 ? { words } : {}),
    });
  }

  const text =
    typeof payload?.text === "string" && payload.text.trim().length > 0
      ? payload.text.trim()
      : segments.map((segment) => segment.text).join(" ");

  const language =
    typeof payload?.language === "string" && payload.language.trim().length > 0
      ? payload.language.trim()
      : null;

  const duration = segments.reduce(
    (max, segment) => Math.max(max, segment.endTime),
    0,
  );

  return {
    text,
    language,
    durationSeconds: round(duration, 3),
    segments,
  };
}

function normalizeWords(value, segmentStart, segmentEnd) {
  if (!Array.isArray(value)) return [];
  const words = [];

  for (const item of value) {
    const startTime = Number(item?.start);
    const endTime = Number(item?.end);
    const text = String(item?.word ?? item?.text ?? "").trim();

    if (
      !Number.isFinite(startTime) ||
      !Number.isFinite(endTime) ||
      startTime < segmentStart - 0.25 ||
      endTime > segmentEnd + 0.25 ||
      endTime <= startTime ||
      text.length === 0
    ) {
      continue;
    }

    words.push({
      startTime: round(startTime, 3),
      endTime: round(endTime, 3),
      text,
      ...(Number.isFinite(Number(item?.probability))
        ? { probability: round(Number(item.probability), 4) }
        : {}),
    });
  }

  return words;
}

function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}


/** Whisper can overrun EOF; keep usable timing inside the measured source. */
export function boundTranscriptSegments(segments, duration) {
  if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) return segments;
  const limit = Number(duration);
  return segments.filter(segment => Number(segment.startTime) < limit && Number(segment.endTime) > 0).map(segment => {
    const startTime = Math.max(0, Number(segment.startTime));
    const endTime = Math.min(limit, Number(segment.endTime));
    const words = Array.isArray(segment.words) ? segment.words
      .filter(word => word.startTime < endTime && word.endTime > startTime)
      .map(word => ({ ...word, startTime: Math.max(startTime, word.startTime), endTime: Math.min(endTime, word.endTime) })) : null;
    return { ...segment, startTime, endTime,
      ...(startTime !== segment.startTime || endTime !== segment.endTime ? { timingAdjustedToSource: true } : {}),
      ...(words ? { words } : {}),
    };
  }).filter(segment => segment.endTime > segment.startTime);
}
