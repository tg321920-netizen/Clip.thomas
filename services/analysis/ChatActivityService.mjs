import { createHmac, randomBytes } from "node:crypto";

/** Bounded, room-specific counters. Raw text and participant IDs never leave memory. */
export class ChatActivityCollector {
  constructor({ roomId, binSeconds = 10, maxBins = 360, maxMessages = 20000, now = Date.now } = {}) {
    if (!String(roomId || "").trim() || !Number.isSafeInteger(binSeconds) || binSeconds < 1 || binSeconds > 60 ||
        !Number.isSafeInteger(maxBins) || maxBins < 1 || maxBins > 1440 || !Number.isSafeInteger(maxMessages) || maxMessages < 1 || maxMessages > 100000) {
      throw new Error("La sala y los límites del contador de chat no son válidos.");
    }
    this.roomId = String(roomId); this.binMs = binSeconds * 1000;
    this.maxBins = maxBins; this.maxMessages = maxMessages; this.now = now;
    this.startedAt = now(); this.bins = new Map(); this.seen = new Set(); this.salt = randomBytes(32);
  }
  add({ id, roomId, senderId, content } = {}, receivedAt = this.now()) {
    if (String(roomId) !== this.roomId || id === undefined || senderId === undefined || senderId === null ||
        !String(id).trim() || !String(senderId).trim() || !Number.isFinite(receivedAt) || receivedAt < this.startedAt) return false;
    const text = String(content || "").slice(0, 1000).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
    if (!text) return false;
    const hash = value => createHmac("sha256", this.salt).update(String(value)).digest("hex");
    const messageId = hash(id);
    if (this.seen.has(messageId)) return false;
    const time = Math.floor(receivedAt / this.binMs) * this.binMs;
    let bin = this.bins.get(time);
    if (!bin) {
      bin = { time, messages: 0, senders: new Set(), texts: new Map(), truncated: false };
      this.bins.set(time, bin);
      if (this.bins.size > this.maxBins) this.bins.delete(this.bins.keys().next().value);
    }
    if (bin.messages >= 10000) { bin.truncated = true; return false; }
    this.seen.add(messageId);
    if (this.seen.size > this.maxMessages) this.seen.delete(this.seen.values().next().value);
    const sender = hash(senderId), key = hash(text);
    const phrase = bin.texts.get(key) || { count: 0, senders: new Set() };
    phrase.count++; phrase.senders.add(sender); bin.texts.set(key, phrase);
    bin.messages++; bin.senders.add(sender);
    return true;
  }
  snapshot(until = this.now()) {
    return [...this.bins.values()].sort((a, b) => a.time - b.time).map(bin => {
      let dominant = { count: 0, senders: new Set() };
      for (const phrase of bin.texts.values()) if (phrase.count > dominant.count ||
          (phrase.count === dominant.count && phrase.senders.size > dominant.senders.size)) dominant = phrase;
      return { utc: new Date(bin.time).toISOString(), messages: bin.messages,
        uniqueSenders: bin.senders.size, distinctTexts: bin.texts.size,
        dominantTextCount: dominant.count, dominantTextSenders: dominant.senders.size,
        complete: this.startedAt <= bin.time && until >= bin.time + this.binMs && !bin.truncated };
    });
  }
}

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
    const phraseCount = bin.dominantTextCount, phraseSenders = bin.dominantTextSenders;
    const phraseMeasured = phraseCount !== undefined || phraseSenders !== undefined;
    if (phraseMeasured && (![phraseCount, phraseSenders].every(n => Number.isSafeInteger(n) && n >= 0) ||
        phraseCount > messages || phraseSenders > phraseCount || phraseSenders > uniqueSenders)) continue;
    // A replayed bucket is the same observation, not additional engagement.
    if (!distinct.has(time) || distinct.get(time).messages < messages) distinct.set(time, { time, messages, uniqueSenders, distinctTexts,
      dominantTextCount: phraseMeasured ? phraseCount : null, dominantTextSenders: phraseMeasured ? phraseSenders : null });
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
    // A chorus from many participants is useful evidence. Penalize concentration
    // in very few senders, not the audience repeating the same reaction.
    const participationFactor = Math.min(1, row.uniqueSenders / 8) * Math.min(1, senderDiversity / 0.25);
    const ratio = baseline === null ? null : row.messages / Math.max(1, baseline);
    const measuredPhrase = row.dominantTextCount !== null;
    const repeatShare = row.messages ? (measuredPhrase ? row.dominantTextCount / row.messages : 1 - textDiversity) : 0;
    const previousRepeatShare = baseline === null ? null : median(history.map(b => b.messages ?
      (b.dominantTextCount === null ? 1 - b.distinctTexts / b.messages : b.dominantTextCount / b.messages) : 0));
    const senderBaseline = baseline === null ? null : median(history.map(b => b.uniqueSenders));
    const senderRatio = senderBaseline === null ? null : row.uniqueSenders / Math.max(1, senderBaseline);
    const multipleParticipants = measuredPhrase ? row.dominantTextSenders >= 8 : row.uniqueSenders >= 12;
    const isCollectiveReaction = baseline !== null && multipleParticipants && repeatShare >= 0.4 &&
      ((ratio >= 1.25 && senderRatio >= 1.1) || (measuredPhrase && repeatShare - previousRepeatShare >= 0.2 && senderRatio >= 0.8));
    const volumeScore = isPeak ? Math.min(100, 50 * (ratio - 1)) : 0;
    const repetitionScore = isCollectiveReaction ? Math.min(100, 40 + 35 * repeatShare + 20 * Math.max(0, ratio - 1)) * (measuredPhrase ? 1 : 0.7) : 0;
    const score = baseline === null ? null : Math.round(Math.max(volumeScore, repetitionScore) * participationFactor);
    return { start: (row.time - origin) / 1000, end: (row.time - origin) / 1000 + binSeconds,
      utc: new Date(row.time).toISOString(), messages: row.messages, uniqueSenders: row.uniqueSenders,
      distinctTexts: row.distinctTexts, baselineMessages: baseline, ratio, isPeak, isCollectiveReaction, score,
      repetitionEvidence: { scope: measuredPhrase ? "SAME_TEXT_MEASURED" : "AGGREGATE_REPETITION_ONLY", share: repeatShare,
        dominantTextCount: row.dominantTextCount, dominantTextSenders: row.dominantTextSenders },
      clockUncertaintySeconds, method: "OBSERVED_CHAT_ROLLING_MEDIAN",
      limitations: ["REACTION_DELAY_UNKNOWN", ...(textDiversity < 0.3 ? ["REPETITIVE_TEXT"] : []),
        ...(!measuredPhrase && isCollectiveReaction ? ["REPEATED_PHRASE_PARTICIPANTS_NOT_MEASURED"] : []),
        ...(baseline === null ? ["INSUFFICIENT_CONTIGUOUS_HISTORY"] : [])] };
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
    peakUniqueSenders: Number.isSafeInteger(strongest.uniqueSenders) && strongest.uniqueSenders <= strongest.messages ? strongest.uniqueSenders : null,
    baselineMessages: strongest.baselineMessages, ratio: strongest.ratio, isPeak: strongest.isPeak === true,
    isCollectiveReaction: strongest.isCollectiveReaction === true, repetitionEvidence: strongest.repetitionEvidence,
    observedBuckets: relevant.length, clockUncertaintySeconds: strongest.clockUncertaintySeconds,
    limitations: strongest.limitations, method: strongest.method, reviewRequired: true };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b), middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
