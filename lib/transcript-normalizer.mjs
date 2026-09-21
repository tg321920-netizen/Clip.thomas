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
