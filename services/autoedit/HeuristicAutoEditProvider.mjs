const STOPWORDS = new Set([
  "para","porque","como","esto","esta","este","estos","estas","pero","aunque",
  "desde","hasta","sobre","entre","donde","cuando","quien","quienes","tiene",
  "tienen","tener","todo","todos","todas","mucho","mucha","muchos","muchas",
  "with","that","this","from","have","what","when","where","there","their",
  "about","into","your","youre","because","pour","avec","dans","cette","mais",
  "comme","plus","tout","tous","elles","nous","vous","sans","chez",
]);

export class HeuristicAutoEditProvider {
  constructor(options = {}) {
    this.name = "heuristic-autoedit-v1";
    this.model = null;
    this.preferredCandidateId = options.candidateId || null;
  }

  async prepare({ candidates, transcript, options = {} }) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error("Auto Edit requires analyzed clip candidates.");
    }

    const requestedId = options.candidateId || this.preferredCandidateId;
    const candidate =
      (requestedId &&
        candidates.find((entry) => entry.id === requestedId)) ||
      [...candidates].sort(
        (a, b) =>
          Number(b.viralScore || 0) - Number(a.viralScore || 0) ||
          Number(a.startTime || 0) - Number(b.startTime || 0),
      )[0];

    const hasWordTimestamps = transcriptHasWords(
      transcript,
      candidate.startTime,
      candidate.endTime,
    );

    const subtitleStyle =
      hasWordTimestamps && Number(candidate.viralScore || 0) >= 65
        ? "KARAOKE"
        : Number(candidate.viralScore || 0) >= 55
          ? "VIRAL"
          : "CLEAN";

    return {
      candidateId: candidate.id,
      startTime: candidate.startTime,
      endTime: candidate.endTime,
      title: candidate.title || firstWords(candidate.text, 10),
      hook: candidate.hook || firstSentence(candidate.text),
      description: truncate(candidate.text, 420),
      hashtags: extractHashtags(candidate.text, 5),
      onScreenText: truncate(
        candidate.hook || firstSentence(candidate.text),
        90,
      ),
      recommendedPlatforms: ["TIKTOK", "YOUTUBE", "FACEBOOK"],
      subtitleStyle,
      framingMode: "FILL",
      quality: "BALANCED",
      reason:
        candidate.reason ||
        "Seleccionado por ViralScore y contexto independiente.",
    };
  }
}

function transcriptHasWords(transcript, startTime, endTime) {
  return Boolean(
    transcript?.segments?.some(
      (segment) =>
        Number(segment.endTime) > Number(startTime) &&
        Number(segment.startTime) < Number(endTime) &&
        Array.isArray(segment.words) &&
        segment.words.length > 0,
    ),
  );
}

function extractHashtags(text, limit) {
  const tokens =
    String(text)
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .match(/[a-z0-9]{5,}/g) || [];

  const counts = new Map();
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    counts.set(token, (counts.get(token) || 0) + 1);
  }

  const tags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([token]) => `#${token}`);

  return tags.length > 0 ? tags : ["#contenido"];
}

function firstSentence(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  return clean.split(/(?<=[.!?…])\s+/)[0] || clean;
}

function firstWords(text, count) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, count)
    .join(" ");
}

function truncate(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength
    ? `${text.slice(0, maxLength - 1)}…`
    : text;
}
