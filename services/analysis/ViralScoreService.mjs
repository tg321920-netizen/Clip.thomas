const WEIGHTS = {
  hook: 30,
  semanticInterest: 25,
  emotionTone: 15,
  audioEnergy: 15,
  standaloneComprehensibility: 10,
  durationFit: 5,
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

export function scoreCandidate(candidate) {
  const text = String(candidate?.text || "").trim();
  const duration = Number(candidate?.duration || 0);

  const components = {
    hook: scoreHook(text),
    semanticInterest: scoreSemanticInterest(text),
    emotionTone: scoreEmotion(text),
    audioEnergy: null,
    standaloneComprehensibility: scoreStandalone(text),
    durationFit: scoreDuration(duration),
  };

  let weighted = 0;
  let availableWeight = 0;

  for (const [name, weight] of Object.entries(WEIGHTS)) {
    const value = components[name];
    if (typeof value !== "number") continue;
    weighted += value * weight;
    availableWeight += weight;
  }

  const viralScore =
    availableWeight > 0 ? Math.round(weighted / availableWeight) : 0;

  const reasons = buildReasons(components, text, duration);

  return {
    viralScore: clamp(viralScore),
    components,
    weights: WEIGHTS,
    availableWeight,
    confidence: components.audioEnergy === null ? "MEDIUM" : "HIGH",
    reasons,
    disclaimer:
      "ViralScore es una estimación interna basada en señales disponibles; no garantiza viralidad.",
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

function scoreSemanticInterest(text) {
  const tokens = tokenize(text);
  if (tokens.length === 0) return 0;

  const unique = new Set(tokens);
  const diversity = unique.size / tokens.length;

  let score = 30 + diversity * 35;
  if (CONTRAST_PATTERNS.some((pattern) => pattern.test(text))) score += 15;
  if (/\b\d+[\d.,%]*\b/.test(text)) score += 10;
  if (/[“”"'«»]/.test(text)) score += 5;
  if (tokens.length >= 35) score += 5;
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

  let score = 70;
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

function scoreDuration(duration) {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  if (duration >= 20 && duration <= 40) return 100;
  if (duration >= 15 && duration < 20) return 85;
  if (duration > 40 && duration <= 50) return 85;
  if (duration > 50 && duration <= 60) return 70;

  const distance = duration < 15 ? 15 - duration : duration - 60;
  return clamp(Math.round(60 - distance * 4));
}

function buildReasons(components, text, duration) {
  const reasons = [];
  if (components.hook >= 70) reasons.push("El inicio contiene señales de hook fuertes.");
  if (components.semanticInterest >= 70) reasons.push("El fragmento tiene alta densidad de información o contraste.");
  if (components.emotionTone >= 65) reasons.push("El texto contiene señales claras de emoción o sorpresa.");
  if (components.standaloneComprehensibility >= 75) reasons.push("El fragmento se entiende razonablemente sin contexto adicional.");
  if (components.durationFit >= 85) reasons.push(`La duración de ${Math.round(duration)} s encaja bien con contenido corto.`);
  if (/\?/.test(text) && !reasons.some((reason) => reason.includes("hook"))) {
    reasons.push("Incluye una pregunta que puede sostener la atención.");
  }
  if (reasons.length === 0) {
    reasons.push("Cumple la duración mínima y conserva una idea continua de la transcripción.");
  }
  reasons.push("La señal de energía de audio aún no está disponible y no se inventó.");
  return reasons.slice(0, 5);
}

function tokenize(text) {
  return String(text).toLocaleLowerCase().match(/[\p{L}\p{N}']+/gu) || [];
}

function clamp(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}
