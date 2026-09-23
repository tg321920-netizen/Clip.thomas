const CATEGORY_RULES = [
  {
    category: "SPORTS",
    template: "SPORTS",
    words: ["partido", "gol", "equipo", "liga", "torneo", "fútbol", "futbol", "deporte", "jugador", "selección", "seleccion"],
  },
  {
    category: "ECONOMY",
    template: "ECONOMY",
    words: ["economía", "economia", "inflación", "inflacion", "precio", "mercado", "dólar", "dolar", "empleo", "banco", "interés", "interes"],
  },
  {
    category: "TECH",
    template: "TECH",
    words: ["tecnología", "tecnologia", "inteligencia artificial", "ia", "software", "internet", "aplicación", "aplicacion", "robot", "chip", "digital"],
  },
  {
    category: "POLITICS",
    template: "CLEAN",
    words: ["gobierno", "presidente", "congreso", "diputado", "ministro", "elección", "eleccion", "política", "politica", "ley", "partido político", "partido politico"],
  },
  {
    category: "ENTERTAINMENT",
    template: "CLEAN",
    words: ["actor", "actriz", "cantante", "película", "pelicula", "música", "musica", "serie", "celebridad", "entretenimiento"],
  },
];

const BREAKING_WORDS = [
  "última hora",
  "ultima hora",
  "urgente",
  "emergencia",
  "terremoto",
  "explosión",
  "explosion",
  "incendio",
  "ataque",
  "accidente",
  "evacuación",
  "evacuacion",
];

export function buildNewsBriefFromTranscript(transcript, options = {}) {
  const segments = normalizeSegments(transcript?.segments);
  if (segments.length === 0) {
    throw new Error("A completed transcript with valid segments is required for News Mode.");
  }

  const joined = segments.map((segment) => segment.text).join(" ");
  const classification = classifyNews(joined);
  const targetWords = clampNumber(options.targetWords, 45, 150, 90);
  const selected = selectEvidenceSegments(segments, targetWords);

  const narration = selected.map((segment) => segment.text).join(" ").trim();
  const headlineSource = selected[0]?.text || segments[0].text;
  const headline = makeHeadline(headlineSource);
  const summary = truncateWords(narration, Math.min(targetWords, 80));
  const keyPoints = selected.slice(0, 4).map((segment) => truncateWords(segment.text, 24));

  return {
    category: classification.category,
    template: options.template || classification.template,
    headline,
    summary,
    narration,
    keyPoints,
    sourceEvidence: selected.map((segment) => ({
      segmentId: segment.id,
      startTime: segment.startTime,
      endTime: segment.endTime,
      text: segment.text,
    })),
    disclaimer:
      "Resumen extractivo: el guion se construye únicamente con contenido presente en la transcripción fuente.",
  };
}

export function classifyNews(text) {
  const normalized = String(text || "").toLocaleLowerCase();

  if (BREAKING_WORDS.some((word) => normalized.includes(word))) {
    return { category: "BREAKING", template: "BREAKING" };
  }

  let best = { category: "GENERAL", template: "CLEAN", score: 0 };

  for (const rule of CATEGORY_RULES) {
    const score = rule.words.reduce(
      (total, word) => total + countOccurrences(normalized, word),
      0,
    );

    if (score > best.score) {
      best = {
        category: rule.category,
        template: rule.template,
        score,
      };
    }
  }

  return { category: best.category, template: best.template };
}

export function selectEvidenceSegments(segments, targetWords = 90) {
  const scored = segments
    .map((segment, index) => ({
      ...segment,
      score: segmentScore(segment.text, index),
    }))
    .sort((a, b) => b.score - a.score || a.startTime - b.startTime);

  const selected = [];
  let words = 0;

  for (const segment of scored) {
    if (selected.length >= 5) break;
    if (words >= targetWords && selected.length >= 2) break;

    selected.push(segment);
    words += wordCount(segment.text);
  }

  return selected.sort((a, b) => a.startTime - b.startTime);
}

function segmentScore(text, index) {
  const value = String(text || "").trim();
  const words = wordCount(value);
  let score = Math.min(40, words);

  if (/\b\d+[\d.,%]*\b/.test(value)) score += 12;
  if (/[!?]/.test(value)) score += 6;
  if (/\b(anunció|anuncio|confirmó|confirmo|reportó|reporto|informó|informo|según|segun|hoy|ayer|mañana|manana)\b/i.test(value)) {
    score += 14;
  }
  if (/\b(pero|sin embargo|además|ademas|mientras|después|despues)\b/i.test(value)) {
    score += 5;
  }

  score += Math.max(0, 8 - index * 0.35);
  return score;
}

function normalizeSegments(segments) {
  if (!Array.isArray(segments)) return [];

  return segments
    .map((segment, index) => ({
      id: String(segment?.id || `segment-${index + 1}`),
      startTime: Number(segment?.startTime),
      endTime: Number(segment?.endTime),
      text: String(segment?.text || "").replace(/\s+/g, " ").trim(),
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

function makeHeadline(text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  const firstSentence = clean.split(/(?<=[.!?…])\s+/)[0] || clean;
  return truncateWords(firstSentence, 14).replace(/[.!?…]+$/, "");
}

function truncateWords(text, maxWords) {
  const words = String(text || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length <= maxWords) return words.join(" ");
  return `${words.slice(0, maxWords).join(" ")}…`;
}

function wordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function countOccurrences(text, phrase) {
  if (!phrase) return 0;
  let count = 0;
  let position = 0;

  while (true) {
    const index = text.indexOf(phrase, position);
    if (index < 0) return count;
    count += 1;
    position = index + phrase.length;
  }
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}
