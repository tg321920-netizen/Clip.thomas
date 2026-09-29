import { randomUUID } from "node:crypto";
import { isProjectId } from "../../lib/project-id.mjs";
import {
  requestStructuredJson,
  resolveOpenAICompatibleConfig,
} from "../ai/OpenAICompatibleClient.mjs";
import { SourceRepository } from "../sources/SourceRepository.mjs";
import { AIUsageService } from "../usage/AIUsageService.mjs";
import { MarketingPlanRepository } from "./MarketingPlanRepository.mjs";

const OBJECTIVES = new Set([
  "GET_MESSAGES",
  "GET_CLIENTS",
  "PRESENT_PRODUCT",
  "PRESENT_SERVICE",
  "EXPLAIN_FUNCTION",
  "DEMONSTRATE",
  "PROMOTION",
  "EDUCATE",
  "GENERATE_INTEREST",
  "GET_REGISTRATIONS",
  "DRIVE_TRAFFIC",
]);

const CHANNELS = new Set([
  "FACEBOOK_REELS",
  "INSTAGRAM_REELS",
  "TIKTOK",
  "YOUTUBE_SHORTS",
  "FACEBOOK_POST",
  "INSTAGRAM_POST",
]);

const FORMATS = new Set(["VERTICAL_VIDEO", "STATIC_POST", "CAROUSEL", "TEXT_POST"]);
const MODES = new Set(["AUTO", "AI", "DETERMINISTIC"]);
const MAX_CONTEXT_CHARS = 60_000;

const PLAN_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    objective: { type: "string", enum: [...OBJECTIVES] },
    audience: { type: "string", minLength: 1, maxLength: 300 },
    channels: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", enum: [...CHANNELS] },
    },
    format: { type: "string", enum: [...FORMATS] },
    message: { type: "string", minLength: 1, maxLength: 800 },
    cta: { type: "string", minLength: 1, maxLength: 300 },
    concept: { type: "string", minLength: 1, maxLength: 800 },
    rationale: { type: "string", minLength: 1, maxLength: 1000 },
    recommendedDurationSeconds: {
      anyOf: [
        { type: "integer", minimum: 5, maximum: 180 },
        { type: "null" },
      ],
    },
    evidence: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          extractionId: { type: "string" },
          claim: { type: "string", minLength: 1, maxLength: 300 },
          evidence: { type: "string", minLength: 1, maxLength: 400 },
        },
        required: ["extractionId", "claim", "evidence"],
      },
    },
    missingInformation: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
    assumptions: {
      type: "array",
      maxItems: 12,
      items: { type: "string", minLength: 1, maxLength: 300 },
    },
  },
  required: [
    "objective",
    "audience",
    "channels",
    "format",
    "message",
    "cta",
    "concept",
    "rationale",
    "recommendedDurationSeconds",
    "evidence",
    "missingInformation",
    "assumptions",
  ],
};

export class MarketingBrainService {
  constructor(options = {}) {
    this.sources = options.sources || new SourceRepository();
    this.plans = options.plans || new MarketingPlanRepository();
    this.usage = options.usage || new AIUsageService();
    this.resolveConfig = options.resolveConfig || resolveOpenAICompatibleConfig;
    this.requestJson = options.requestJson || requestStructuredJson;
  }

  async list(filters = {}) {
    return this.plans.list({
      ...(filters.projectId ? { projectId: normalizeProjectId(filters.projectId) } : {}),
      ...(filters.objective ? { objective: normalizeObjective(filters.objective) } : {}),
      ...(filters.mode ? { mode: normalizeStoredMode(filters.mode) } : {}),
    });
  }

  async get(planId) {
    assertUuid(planId, "marketing plan");
    return this.plans.get(planId);
  }

  async createPlan(input = {}) {
    const extractionIds = normalizeExtractionIds(input.extractionIds);
    const extractions = await Promise.all(
      extractionIds.map((id) => this.sources.getExtraction(id)),
    );

    const missingIds = extractionIds.filter((_id, index) => !extractions[index]);
    if (missingIds.length > 0) {
      throw new Error(`Extraction not found: ${missingIds[0]}.`);
    }
    if (extractions.some((record) => record.status !== "COMPLETED")) {
      throw new Error("Marketing Brain only accepts completed extractions.");
    }

    const projectId = resolveProjectId(input.projectId, extractions);
    const brief = normalizeBrief(input);
    const requestedMode = normalizeMode(input.mode);
    const config = this.resolveConfig({
      temperature: input.temperature ?? 0.2,
      maxOutputTokens: input.maxOutputTokens ?? 1800,
    });
    const canUseAi = Boolean(config.apiKey && config.model);
    const useAi = requestedMode === "AI" || (requestedMode === "AUTO" && canUseAi);

    if (requestedMode === "AI" && !canUseAi) {
      throw new Error(
        "Marketing Brain AI mode requires CLIPFORGE_AI_API_KEY/OPENAI_API_KEY and CLIPFORGE_AI_MODEL.",
      );
    }

    let strategy;
    let mode;
    let provider = null;
    let model = null;

    if (useAi) {
      const result = await this.requestJson({
        config,
        name: "clipforge_marketing_plan",
        schema: PLAN_SCHEMA,
        instructions: marketingInstructions(),
        input: buildAiInput(extractions, brief),
      });
      strategy = normalizeAiStrategy(result.parsed, extractions, brief);
      mode = "AI";
      provider = providerName(config.baseUrl);
      model = config.model;
      await this.#recordUsage({ result, provider, model, projectId });
    } else {
      strategy = deterministicStrategy(extractions, brief);
      mode = "DETERMINISTIC";
    }

    const plan = {
      id: randomUUID(),
      projectId,
      extractionIds,
      ...strategy,
      mode,
      provider,
      model,
      brief,
      createdAt: new Date().toISOString(),
    };

    await this.plans.save(plan);
    return plan;
  }

  async #recordUsage({ result, provider, model, projectId }) {
    try {
      await this.usage.record({
        operation: "marketing-brain-plan",
        provider,
        model,
        inputTokens: Number(result?.usage?.inputTokens || 0),
        outputTokens: Number(result?.usage?.outputTokens || 0),
        estimatedCostUsd: null,
        projectId,
      });
    } catch {
      // Usage accounting must never destroy an otherwise valid plan.
    }
  }
}

function normalizeBrief(input) {
  const objective = input.objective ? normalizeObjective(input.objective) : null;
  const channels = input.channels ? normalizeChannels(input.channels) : [];
  const format = input.format ? normalizeFormat(input.format) : null;
  return {
    objective,
    audience: cleanText(input.audience, 300) || null,
    channels,
    format,
    instructions: cleanText(input.instructions, 2000) || null,
    language: cleanText(input.language, 40) || "es",
  };
}

function deterministicStrategy(extractions, brief) {
  const evidence = collectDeterministicEvidence(extractions);
  const ctas = extractions.flatMap((record) => record?.signals?.ctaCandidates || []);
  const objective = brief.objective || inferObjective(extractions);
  const channels = brief.channels.length > 0
    ? brief.channels
    : ["INSTAGRAM_REELS", "FACEBOOK_REELS"];
  const format = brief.format || inferFormat(channels);
  const audience = brief.audience || "Por definir";
  const missingInformation = [];
  if (!brief.audience) missingInformation.push("Público objetivo específico.");
  if (evidence.length === 0) missingInformation.push("Hechos concretos suficientes para sustentar la campaña.");

  const summary = firstUsefulSummary(extractions);
  const message = summary
    ? cleanText(summary, 500)
    : "Presentar la propuesta usando únicamente información confirmada de la fuente.";

  return {
    objective,
    audience,
    channels,
    format,
    message,
    cta: cleanText(ctas[0], 260) || defaultCta(objective),
    concept: defaultConcept(extractions, objective),
    rationale:
      "Plan base de bajo costo construido sin llamada a IA. Prioriza un formato breve y hechos ya extraídos; puede refinarse cuando exista más información o se habilite IA.",
    recommendedDurationSeconds: format === "VERTICAL_VIDEO" ? 18 : null,
    evidence,
    missingInformation,
    assumptions: [
      ...(brief.audience ? [] : ["La audiencia todavía no fue definida por el usuario."]),
      ...(brief.channels.length > 0
        ? []
        : ["Instagram Reels y Facebook Reels se usan como canales iniciales por defecto, no como conclusión de rendimiento."]),
    ],
  };
}

function normalizeAiStrategy(raw, extractions, brief) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Marketing Brain returned an invalid plan object.");
  }

  const objective = brief.objective || normalizeObjective(raw.objective);
  const channels = brief.channels.length > 0 ? brief.channels : normalizeChannels(raw.channels);
  const format = brief.format || normalizeFormat(raw.format);
  const audience = brief.audience || cleanRequired(raw.audience, "audience", 300);
  const evidence = validateEvidence(raw.evidence, extractions);
  const assumptions = normalizeTextArray(raw.assumptions, 12, 300);
  const missingInformation = normalizeTextArray(raw.missingInformation, 12, 300);

  if (Array.isArray(raw.evidence) && raw.evidence.length > evidence.length) {
    assumptions.push(
      "Se descartaron afirmaciones de evidencia que no pudieron verificarse literalmente en las extracciones.",
    );
  }

  return {
    objective,
    audience,
    channels,
    format,
    message: cleanRequired(raw.message, "message", 800),
    cta: cleanRequired(raw.cta, "cta", 300),
    concept: cleanRequired(raw.concept, "concept", 800),
    rationale: cleanRequired(raw.rationale, "rationale", 1000),
    recommendedDurationSeconds: normalizeDuration(raw.recommendedDurationSeconds, format),
    evidence,
    missingInformation,
    assumptions: unique(assumptions).slice(0, 12),
  };
}

function buildAiInput(extractions, brief) {
  let remaining = MAX_CONTEXT_CHARS;
  const sources = [];

  for (const extraction of extractions) {
    const prefix = JSON.stringify({
      extractionId: extraction.id,
      sourceType: extraction.sourceType,
      signals: extraction.signals,
      metadata: extraction.metadata,
    });
    const allowance = Math.max(0, remaining - prefix.length - 100);
    const text = String(extraction.text || "").slice(0, allowance);
    sources.push({
      extractionId: extraction.id,
      sourceType: extraction.sourceType,
      summary: extraction.summary,
      signals: extraction.signals,
      metadata: extraction.metadata,
      text,
    });
    remaining -= prefix.length + text.length;
    if (remaining <= 0) break;
  }

  return {
    task: "Create a marketing strategy plan before content generation.",
    userBrief: brief,
    sources,
  };
}

function marketingInstructions() {
  return [
    "You are the ClipForge Marketing Brain.",
    "Create a small marketing plan, not the final post or final script.",
    "Use only factual claims present in the provided extractions.",
    "Never invent prices, discounts, contact details, locations, product capabilities, availability, guarantees, or performance claims.",
    "Creative positioning is allowed, but label unsupported targeting or creative choices as assumptions.",
    "For every evidence item, copy a short verbatim excerpt from the matching extraction and include its exact extractionId.",
    "If important information is absent, add it to missingInformation instead of guessing.",
    "Respect objective, audience, channels, and format supplied in userBrief when present.",
    "Prefer concise mobile-first social formats when the brief does not specify a format.",
  ].join("\n");
}

function collectDeterministicEvidence(extractions) {
  const result = [];
  for (const extraction of extractions) {
    const signals = extraction.signals || {};
    for (const price of signals.prices || []) {
      result.push({ extractionId: extraction.id, claim: `Precio mencionado: ${price}`, evidence: price });
    }
    for (const email of signals.emails || []) {
      result.push({ extractionId: extraction.id, claim: `Contacto mencionado: ${email}`, evidence: email });
    }
    for (const phone of signals.phones || []) {
      result.push({ extractionId: extraction.id, claim: `Teléfono mencionado: ${phone}`, evidence: phone });
    }
    if (result.length >= 8) break;
  }

  if (result.length === 0) {
    for (const extraction of extractions) {
      const snippet = firstSentence(extraction.summary || extraction.text || "");
      if (snippet) {
        result.push({ extractionId: extraction.id, claim: snippet, evidence: snippet });
      }
      if (result.length >= 4) break;
    }
  }
  return result.slice(0, 12);
}

function validateEvidence(rawEvidence, extractions) {
  const records = new Map(extractions.map((record) => [record.id, record]));
  const verified = [];
  for (const item of Array.isArray(rawEvidence) ? rawEvidence : []) {
    const extractionId = String(item?.extractionId || "").trim();
    const record = records.get(extractionId);
    if (!record) continue;
    const evidence = cleanText(item?.evidence, 400);
    const claim = cleanText(item?.claim, 300);
    if (!evidence || !claim) continue;
    if (!containsNormalized(record.text || "", evidence)) continue;
    verified.push({ extractionId, claim, evidence });
    if (verified.length >= 12) break;
  }
  return verified;
}

function resolveProjectId(inputProjectId, extractions) {
  const requested = inputProjectId ? normalizeProjectId(inputProjectId) : null;
  const sourceIds = unique(
    extractions.map((record) => record.projectId).filter(Boolean),
  );
  if (sourceIds.length > 1) {
    throw new Error("Cannot mix extractions from different ClipForge projects in one marketing plan.");
  }
  if (requested && sourceIds[0] && requested !== sourceIds[0]) {
    throw new Error("Marketing plan projectId does not match the source project.");
  }
  return requested || sourceIds[0] || null;
}

function normalizeExtractionIds(value) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("At least one extractionId is required.");
  }
  const ids = unique(value.map((item) => String(item || "").trim()));
  if (ids.length > 12) throw new Error("A marketing plan cannot use more than 12 extractions.");
  for (const id of ids) assertUuid(id, "extraction");
  return ids;
}

function normalizeObjective(value) {
  const objective = String(value || "").trim().toUpperCase();
  if (!OBJECTIVES.has(objective)) throw new Error(`Unsupported marketing objective: ${objective || "missing"}.`);
  return objective;
}

function normalizeChannels(value) {
  if (!Array.isArray(value)) throw new Error("channels must be an array.");
  const channels = unique(value.map((item) => String(item || "").trim().toUpperCase()));
  if (channels.length === 0 || channels.length > 4) {
    throw new Error("Choose between 1 and 4 marketing channels.");
  }
  for (const channel of channels) {
    if (!CHANNELS.has(channel)) throw new Error(`Unsupported marketing channel: ${channel}.`);
  }
  return channels;
}

function normalizeFormat(value) {
  const format = String(value || "").trim().toUpperCase();
  if (!FORMATS.has(format)) throw new Error(`Unsupported marketing format: ${format || "missing"}.`);
  return format;
}

function normalizeMode(value) {
  const mode = String(value || process.env.CLIPFORGE_MARKETING_BRAIN_MODE || "AUTO")
    .trim()
    .toUpperCase();
  if (!MODES.has(mode)) throw new Error("Marketing Brain mode must be AUTO, AI, or DETERMINISTIC.");
  return mode;
}

function normalizeStoredMode(value) {
  const mode = String(value || "").trim().toUpperCase();
  if (!new Set(["AI", "DETERMINISTIC"]).has(mode)) {
    throw new Error("Stored Marketing Brain mode must be AI or DETERMINISTIC.");
  }
  return mode;
}

function inferObjective(extractions) {
  const ctas = extractions.flatMap((record) => record?.signals?.ctaCandidates || []);
  if (ctas.some((value) => /whatsapp|escrib|contact|llam/i.test(value))) return "GET_MESSAGES";
  return "GENERATE_INTEREST";
}

function inferFormat(channels) {
  return channels.some((channel) => channel.endsWith("REELS") || channel === "TIKTOK" || channel === "YOUTUBE_SHORTS")
    ? "VERTICAL_VIDEO"
    : "STATIC_POST";
}

function defaultCta(objective) {
  if (objective === "GET_MESSAGES" || objective === "GET_CLIENTS") return "Escribí para conocer más.";
  if (objective === "GET_REGISTRATIONS") return "Registrate para recibir más información.";
  if (objective === "DRIVE_TRAFFIC") return "Conocé más en el sitio oficial.";
  if (objective === "DEMONSTRATE") return "Solicitá una demostración.";
  return "Conocé más.";
}

function defaultConcept(extractions, objective) {
  const hasVideoEvidence = extractions.some((record) => record.sourceType === "CLIPFORGE_PROJECT");
  if (hasVideoEvidence) {
    return objective === "DEMONSTRATE"
      ? "Usar un fragmento existente que muestre la función en acción y cerrar con un CTA claro."
      : "Reutilizar el momento más claro del material existente para comunicar una sola idea principal."
  }
  return "Convertir un hecho verificable de la fuente en una pieza breve: problema o contexto, dato principal y CTA.";
}

function firstUsefulSummary(extractions) {
  return extractions.map((record) => String(record.summary || "").trim()).find(Boolean) || "";
}

function firstSentence(value) {
  const text = cleanText(value, 400);
  if (!text) return "";
  return text.split(/(?<=[.!?])\s+/)[0].slice(0, 300);
}

function containsNormalized(haystack, needle) {
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  const target = normalize(needle);
  return target.length >= 2 && normalize(haystack).includes(target);
}

function normalizeDuration(value, format) {
  if (value === null || value === undefined || value === "") {
    return format === "VERTICAL_VIDEO" ? 18 : null;
  }
  const number = Number(value);
  if (!Number.isInteger(number) || number < 5 || number > 180) {
    throw new Error("recommendedDurationSeconds must be an integer between 5 and 180.");
  }
  return format === "VERTICAL_VIDEO" ? number : null;
}

function normalizeTextArray(value, maxItems, maxLength) {
  if (!Array.isArray(value)) return [];
  return unique(value.map((item) => cleanText(item, maxLength)).filter(Boolean)).slice(0, maxItems);
}

function providerName(baseUrl) {
  try {
    return new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return "openai-compatible";
  }
}

function normalizeProjectId(value) {
  const projectId = String(value || "").trim();
  if (!isProjectId(projectId)) throw new Error("Invalid project id.");
  return projectId;
}

function assertUuid(value, label) {
  if (!isProjectId(value)) throw new Error(`Invalid ${label} id.`);
}

function cleanRequired(value, label, maxLength) {
  const text = cleanText(value, maxLength);
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function unique(values) {
  return [...new Set(values)];
}
