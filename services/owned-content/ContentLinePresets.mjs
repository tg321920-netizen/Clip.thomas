const PRESETS = Object.freeze({
  US_NEWS_EN: {
    key: "US_NEWS_EN",
    name: "US NEWS EN",
    language: "en-US",
    targetCountry: "US",
    targetAudience: "United States news and current-events audience",
    niche: "US news, current events and verified trends",
    voiceProfile: "US_NEWS_EN",
    strategy: "Prioritize timely, source-backed US stories. Separate fact from attribution and analysis. Avoid sensational claims unsupported by the research dossier.",
    preferredSources: ["official primary sources", "reputable US newsrooms", "public records"],
    rules: [
      "Use at least two independent sources for a news story.",
      "Do not present allegations or rumors as facts.",
      "Prefer original narration and owned or clearly permitted visuals.",
    ],
    formats: ["SHORT", "MEDIUM", "LONG"],
    defaultFormat: "SHORT",
    budget: zeroBudget(),
  },
  LATAM_NEWS_ES: {
    key: "LATAM_NEWS_ES",
    name: "LATAM NEWS ES",
    language: "es-419",
    targetCountry: "LATAM",
    targetAudience: "Audiencia latinoamericana interesada en noticias y temas virales",
    niche: "noticias, acontecimientos y tendencias verificadas de Latinoamérica",
    voiceProfile: "LATAM_NEWS_ES",
    strategy: "Explicar noticias latinoamericanas con contexto regional, fuentes múltiples y lenguaje claro. Diferenciar hechos, declaraciones, análisis e información no confirmada.",
    preferredSources: ["fuentes oficiales", "medios regionales reputados", "documentos públicos"],
    rules: [
      "Usar al menos dos fuentes independientes.",
      "Atribuir declaraciones y versiones no confirmadas.",
      "No exagerar titulares para obtener clics.",
    ],
    formats: ["SHORT", "MEDIUM", "LONG"],
    defaultFormat: "SHORT",
    budget: zeroBudget(),
  },
  ENTERTAINMENT_GOSSIP_ES: {
    key: "ENTERTAINMENT_GOSSIP_ES",
    name: "ENTERTAINMENT / GOSSIP ES",
    language: "es-419",
    targetCountry: "LATAM",
    targetAudience: "Audiencia hispanohablante interesada en entretenimiento, creadores e influencers",
    niche: "espectáculo, celebridades, influencers, streamers y polémicas verificables",
    voiceProfile: "ENTERTAINMENT_ES",
    strategy: "Cubrir entretenimiento con ritmo y claridad sin convertir rumores en hechos. Identificar el origen de cada declaración y dar prioridad a fuentes directas cuando existan.",
    preferredSources: ["cuentas oficiales verificables", "entrevistas originales", "medios de entretenimiento reputados"],
    rules: [
      "Una polémica no se considera hecho solo por ser viral.",
      "Diferenciar claramente declaración, rumor, análisis y hecho confirmado.",
      "No reutilizar clips de terceros solo agregando subtítulos o efectos.",
    ],
    formats: ["SHORT", "MEDIUM", "LONG"],
    defaultFormat: "SHORT",
    budget: zeroBudget(),
  },
});

export function listContentLinePresets() {
  return Object.values(PRESETS).map(clone);
}

export function getContentLinePreset(key) {
  const normalized = String(key || "").trim().toUpperCase();
  const preset = PRESETS[normalized];
  if (!preset) throw new Error("Unsupported owned-content preset.");
  return clone(preset);
}

export function applyContentLinePreset(profile = {}, key) {
  const preset = getContentLinePreset(key);
  return {
    ...profile,
    scope: "OWNED_CONTENT",
    lineKey: preset.key,
    language: preset.language,
    targetCountry: preset.targetCountry,
    targetAudience: preset.targetAudience,
    niche: preset.niche,
    voiceProfile: preset.voiceProfile,
    strategyText: preset.strategy,
    preferredSources: [...preset.preferredSources],
    rules: [...preset.rules],
    formats: [...preset.formats],
    defaultFormat: preset.defaultFormat,
    budget: { ...preset.budget },
  };
}

export function zeroBudget() {
  return {
    dailyBudgetUsd: 0,
    monthlyBudgetUsd: 0,
    maxCostPerContentUsd: 0,
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
