/** Measured chat is supporting evidence, never proof of a good scene or permission. */
export function buildChatActivityWindows(bins, { sourceStartUtc, binSeconds = 10, clockUncertaintySeconds = 10 } = {}) {
  const origin = Date.parse(sourceStartUtc);
  if (!Number.isFinite(origin)) throw new Error("Falta el inicio UTC del video para alinear el chat.");
  if (!Number.isFinite(binSeconds) || binSeconds < 1 || binSeconds > 60 ||
      !Number.isFinite(clockUncertaintySeconds) || clockUncertaintySeconds < 0 || clockUncertaintySeconds > 60) {
    throw new Error("El intervalo o la incertidumbre del reloj del chat no son válidos.");
  }
  const distinct = new Map();
  for (const bin of Array.isArray(bins) ? bins : []) {
    const time = Date.parse(bin?.utc);
    const { messages, uniqueSenders, distinctTexts } = bin || {};
    if (!Number.isFinite(time) || ![messages, uniqueSenders, distinctTexts].every(n => Number.isSafeInteger(n) && n >= 0) ||
        uniqueSenders > messages || distinctTexts > messages || bin.complete === false) continue;
    // A replayed bucket is the same observation, not additional engagement.
    if (!distinct.has(time) || distinct.get(time).messages < messages) distinct.set(time, { time, messages, uniqueSenders, distinctTexts });
  }
  const rows = [...distinct.values()].sort((a, b) => a.time - b.time);
  return rows.map((row, index) => {
    const history = rows.slice(Math.max(0, index - 6), index);
    const contiguous = history.length === 6 && [...history, row].every((entry, i, all) => i === 0 || Math.abs(entry.time - all[i - 1].time - binSeconds * 1000) < 100);
    const baseline = contiguous ? median(history.map(b => b.messages)) : null;
    const deviation = baseline === null ? null : median(history.map(b => Math.abs(b.messages - baseline)));
    const threshold = baseline === null ? null : Math.max(6, baseline * 1.5, baseline + 3 * Math.max(2, deviation));
    const isPeak = threshold !== null && row.messages >= threshold;
    const senderDiversity = row.messages ? row.uniqueSenders / row.messages : 0;
    const textDiversity = row.messages ? row.distinctTexts / row.messages : 0;
    const diversityFactor = Math.min(1, senderDiversity / 0.6) * Math.max(0.1, Math.min(1, textDiversity / 0.3));
    const ratio = baseline === null ? null : row.messages / Math.max(1, baseline);
    const score = baseline === null ? null : isPeak ? Math.round(Math.min(100, 50 * (ratio - 1)) * diversityFactor) : 0;
    return { start: (row.time - origin) / 1000, end: (row.time - origin) / 1000 + binSeconds,
      utc: new Date(row.time).toISOString(), messages: row.messages, uniqueSenders: row.uniqueSenders,
      distinctTexts: row.distinctTexts, baselineMessages: baseline, ratio, isPeak, score,
      clockUncertaintySeconds, method: "OBSERVED_CHAT_ROLLING_MEDIAN",
      limitations: ["REACTION_DELAY_UNKNOWN", ...(textDiversity < 0.3 ? ["REPETITIVE_TEXT"] : []), ...(baseline === null ? ["INSUFFICIENT_CONTIGUOUS_HISTORY"] : [])] };
  });
}

export function chatEvidenceForWindow(candidate, windows) {
  const relevant = (Array.isArray(windows) ? windows : []).filter(w =>
    Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start &&
    Number.isFinite(w.score) && w.score >= 0 && w.score <= 100 &&
    Number.isSafeInteger(w.messages) && w.messages >= 0 &&
    Math.min(candidate.endTime, w.end) - Math.max(candidate.startTime, w.start) >= 1);
  if (!relevant.length) return null;
  const strongest = relevant.reduce((best, row) => row.score > best.score ||
    (row.score === best.score && row.messages > best.messages) ? row : best);
  return { score: strongest.score, peakUtc: strongest.utc, peakMessages: strongest.messages,
    baselineMessages: strongest.baselineMessages, ratio: strongest.ratio, isPeak: strongest.isPeak === true,
    observedBuckets: relevant.length, clockUncertaintySeconds: strongest.clockUncertaintySeconds,
    limitations: strongest.limitations, method: strongest.method, reviewRequired: true };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
