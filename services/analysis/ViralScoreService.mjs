const WEIGHTS = {
  hook: 22,
  clarity: 16,
  relevance: 18,
  emotionTone: 10,
  standaloneComprehensibility: 16,
  shortFormPotential: 13,
  audioEnergy: 5,
};

const HOOK_PATTERNS = [
  /\?/,
  /\b(por qué|porque|cómo|como|qué pasa|que pasa|sabías|sabias|mira|ojo|imagina|nunca|nadie|esto|te voy a contar|lo que pasó|lo que paso)\b/i,
  /\b(why|how|what happened|did you know|look|watch this|imagine|never|nobody|here'?s|the reason)\b/i,
  /\b(pourquoi|comment|regarde|imagine|jamais|personne|voici)\b/i,
];

const EMOTION_PATTERNS = [
  /!/,
  /\b(increíble|increible|impactante|sorpresa|miedo|feliz|felicidad|triste|enojo|enojado|amor|odio|risa|gracioso|loco|brutal|terrible)\b/i,
  /\b(amazing|shocking|surprise|scared|happy|sad|angry|love|hate|funny|crazy|terrible|wild)\b/i,
  /\b(incroyable|choquant|surprise|peur|heureux|triste|drôle|drole|fou|terrible)\b/i,
];

const CONTRAST_PATTERNS = [
  /\b(pero|sin embargo|aunque|en cambio|resulta que|hasta que|de repente)\b/i,
  /\b(but|however|although|instead|turns out|until|suddenly)\b/i,
  /\b(mais|cependant|pourtant|soudain)\b/i,
];

const FRAGMENT_START =
  /^(y|pero|entonces|porque|pues|bueno|so|but|and|because|then|well|et|mais|donc|parce que)\b/i;

export function scoreCandidate(candidate, options = {}) {
  const text = String(candidate?.text || "").trim();
  const duration = Number(candidate?.duration || 0);
  const audioEnergy = normalizeOptionalScore(options.audioEnergy ?? candidate?.audioEnergy);

  const components = {
    hook: scoreHook(text),
    clarity: scoreClarity(text),
    relevance: scoreRelevance(text),
    emotionTone: scoreEmotion(text),
    standaloneComprehensibility: scoreStandalone(text),
    shortFormPotential: scoreShortFormPotential(text, duration),
    audioEnergy,
  };

  let weighted = 0;
  let availableWeight = 0;

  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const value = components[name];
    if (typeof value !== "number") continue;
    weighted += value * weight;
    availableWeight += weight;
  }

  const baseScore = availableWeight > 0
    ? Math.round(weighted / availableWeight)
    : 0;
  const redundancyPenalty = clampPenalty(options.redundancyPenalty || 0);
  const viralScore = clamp(baseScore - redundancyPenalty);
  const reasons = buildReasons(components, text, duration, redundancyPenalty);

  return {
    viralScore,
    baseScore: clamp(baseScore),
    redundancyPenalty,
    components,
    weights: WEIGHTS,
    availableWeight,
    confidence: components.audioEnergy === null ? "MEDIUM" : "HIGH",
    reasons,
    disclaimer:
      "ViralScore es una estimación interna basada en señales del contenido; no usa ni inventa estadísticas reales de engagement y no garantiza viralidad.",
  };
}

function scoreHook(text) {
  if (!text) return 0;
  let score = 35;
  if (HOOK_PATTERNS.some((pattern) => pattern.test(text))) score += 35;
  if (/^.{0,80}[?!]/.test(text)) score += 12;
  if (/\b\d+[\d.,%]*\b/.test(text)) score += 8;
  if (text.split(/\s+/).length >= 8) score += 5;
  return clamp(score);
}

function scoreClarity(text) {
  const words = tokenize(text);
  if (words.length === 0) return 0;

  let score = 55;
  const averageWordLength = words.reduce((sum, word) => sum + word.length, 0) / words.length;
  const sentenceCount = Math.max(1, (text.match(/[.!?…]+/g) || []).length);
  const wordsPerSentence = words.length / sentenceCount;

  if (words.length >= 12) score += 10;
  if (words.length >= 25) score += 8;
  if (wordsPerSentence >= 6 && wordsPerSentence <= 28) score += 12;
  if (averageWordLength >= 3 && averageWordLength <= 9) score += 8;
  if (/\b(este|esto|eso|aquello|this|that|it)\b/i.test(text.slice(0, 35))) score -= 10;
  if (/(\b\w+\b)(?:\s+\1){2,}/i.test(text)) score -= 20;
  return clamp(score);
}

function scoreRelevance(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  const unique = new Set(tokens);
  const diversity = unique.size / tokens.length;
  let score = 32 + diversity * 34;

  if (CONTRAST_PATTERNS.some((pattern) => pattern.test(text))) score += 14;
  if (/\b\d+[\d.,%]*\b/.test(text)) score += 9;
  if (/[“”"'«»]/.test(text)) score += 4;
  if (tokens.length >= 30) score += 7;
  return clamp(Math.round(score));
}

function scoreEmotion(text) {
  if (!text) return 0;
  let score = 25;
  const matches = EMOTION_PATTERNS.reduce(
    (count, pattern) => count + (pattern.test(text) ? 1 : 0),
    0,
  );
  score += matches * 20;
  if ((text.match(/!/g) || []).length >= 2) score += 10;
  return clamp(score);
}

function scoreStandalone(text) {
  const trimmed = text.trim();
  if (!trimmed) return 0;

  let score = 72;
  if (FRAGMENT_START.test(trimmed)) score -= 25;
  if (!/[.!?…]["'»”)]?$/.test(trimmed)) score -= 10;
  if (trimmed.split(/\s+/).length < 12) score -= 15;
  if (
    /\b(esto|eso|él|ella|ellos|ellas|this|that|he|she|they)\b/i.test(
      trimmed.slice(0, 45),
    )
  ) score -= 8;
  if (/\b(porque|because|car|ya que)\b/i.test(trimmed)) score += 5;
  return clamp(score);
}

function scoreShortFormPotential(text, duration) {
  const durationScore = scoreDuration(duration);
  const hookScore = scoreHook(text);
  const standalone = scoreStandalone(text);
  return clamp(Math.round(durationScore * 0.45 + hookScore * 0.25 + standalone * 0.3));
}

function scoreDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (duration >= 20 && duration <= 45) return 100;
  if (duration >= 15 && duration < 20) return 88;
  if (duration > 45 && duration <= 60) return 86;
  if (duration > 60 && duration <= 90) return 72;
  if (duration > 90 && duration <= 180) return 55;

  const distance = duration < 15 ? 15 - duration : duration - 180;
  return clamp(Math.round(55 - distance * 2));
}

function buildReasons(components, text, duration, redundancyPenalty) {
  const reasons = [];
  if (components.hook >= 70) reasons.push("El inicio contiene señales de hook fuertes.");
  if (components.clarity >= 75) reasons.push("La idea se expresa con buena claridad para un clip corto.");
  if (components.relevance >= 70) reasons.push("El fragmento concentra información, contraste o detalles relevantes.");
  if (components.emotionTone >= 65) reasons.push("El texto contiene señales claras de emoción o sorpresa.");
  if (components.standaloneComprehensibility >= 75) reasons.push("El fragmento se entiende razonablemente sin contexto adicional.");
  if (components.shortFormPotential >= 80) reasons.push(`La duración de ${Math.round(duration)} s y su estructura encajan bien con contenido corto.`);
  if (redundancyPenalty > 0) reasons.push(`Se descontaron ${redundancyPenalty} puntos por similitud con otro candidato mejor posicionado.`);
  if (/\?/.test(text) && !reasons.some((reason) => reason.includes("hook"))) {
    reasons.push("Incluye una pregunta que puede sostener la atención.");
  }
  if (reasons.length === 0) {
    reasons.push("Conserva una idea continua y utilizable de la transcripción.");
  }
  if (components.audioEnergy === null) {
    reasons.push("La señal de energía de audio no estaba disponible y no se inventó.");
  }
  return reasons.slice(0, 6);
}

function tokenize(text) {
  return String(text).toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

function normalizeOptionalScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? clamp(number) : null;
}

function clampPenalty(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(40, Math.round(number)));
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
