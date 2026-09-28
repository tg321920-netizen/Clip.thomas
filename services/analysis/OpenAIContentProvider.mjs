import { AIUsageService } from "../usage/AIUsageService.mjs";
import {
  extractCompatibleText,
  extractCompatibleUsage,
  requestStructuredJson,
  resolveOpenAICompatibleConfig,
} from "../ai/OpenAICompatibleClient.mjs";
import { TranscriptCandidateProvider } from "./TranscriptCandidateProvider.mjs";

export class OpenAIContentProvider {
  constructor(options = {}) {
    this.config = resolveOpenAICompatibleConfig(options);
    this.name = `openai-compatible-${this.config.apiStyle}-v1`;
    this.apiKey = this.config.apiKey;
    this.model = this.config.model;
    this.baseUrl = this.config.baseUrl;
    this.apiStyle = this.config.apiStyle;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.usage = options.usageService ?? new AIUsageService();
  }

  async analyze({ project, transcript, options = {} }) {
    const maxCandidates = Math.max(1, Number(options.maxCandidates || 10));
    const baselineProvider = new TranscriptCandidateProvider({
      ...options,
      maxCandidates: Math.min(50, Math.max(maxCandidates * 3, maxCandidates)),
    });
    const baseline = await baselineProvider.analyze({ transcript, options });

    const schema = {
      type: "object",
      properties: {
        selections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              candidateId: { type: "string" },
              title: { type: "string" },
              hook: { type: "string" },
              reason: { type: "string" },
              relevanceScore: { type: "integer", minimum: 0, maximum: 100 },
            },
            required: ["candidateId", "title", "hook", "reason", "relevanceScore"],
            additionalProperties: false,
          },
        },
      },
      required: ["selections"],
      additionalProperties: false,
    };

    const result = await requestStructuredJson({
      config: this.config,
      name: "clipforge_candidate_selection",
      schema,
      instructions:
        "You are ClipForge's content-selection engine. Select the strongest short-form candidates only from the supplied candidate IDs. Never invent timestamps or candidate IDs. Prefer clear hooks, relevant ideas, self-contained context, concise delivery and low redundancy. Do not claim real engagement statistics. Return concise Spanish metadata unless the transcript is clearly in another language.",
      input: {
        maxCandidates,
        candidates: baseline.map((candidate) => ({
          candidateId: candidate.id,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          duration: candidate.duration,
          transcript: candidate.text,
          baselineViralScore: candidate.viralScore,
          baselineReasons: candidate.reasons,
          scoreComponents: candidate.components,
          redundancy: candidate.redundancy,
        })),
      },
      fetchImpl: this.fetchImpl,
    });

    await recordUsageSafely(this.usage, {
      usage: result.usage,
      provider: this.apiStyle === "responses" ? "openai" : this.name,
      model: this.model,
      operation: "content-analysis",
      projectId: project?.id || project?.projectId || null,
    });

    const selectedIds = new Set();
    const selected = [];

    for (const item of Array.isArray(result.parsed?.selections) ? result.parsed.selections : []) {
      if (selected.length >= maxCandidates) break;
      if (!item || typeof item.candidateId !== "string") continue;
      if (selectedIds.has(item.candidateId)) continue;

      const candidate = baseline.find((entry) => entry.id === item.candidateId);
      if (!candidate) continue;

      selectedIds.add(candidate.id);
      selected.push({
        ...candidate,
        title: cleanText(item.title, candidate.title, 120),
        hook: cleanText(item.hook, candidate.hook, 180),
        reason: cleanText(item.reason, candidate.reason, 500),
        analysisMethod: `${this.name}+${candidate.analysisMethod}`,
        aiAssessment: {
          provider: this.name,
          model: this.model,
          apiStyle: this.apiStyle,
          relevanceScore: clampScore(item.relevanceScore),
          reason: cleanText(item.reason, "", 500),
        },
      });
    }

    for (const candidate of baseline) {
      if (selected.length >= maxCandidates) break;
      if (selectedIds.has(candidate.id)) continue;
      selected.push(candidate);
    }

    if (selected.length === 0) {
      throw new Error("The configured AI provider did not return any valid candidate selections.");
    }

    return selected;
  }
}

// Backward-compatible exports used by existing tests/services.
export function extractOutputText(responseBody) {
  return extractCompatibleText(responseBody);
}

export function extractOpenAIUsage(responseBody) {
  return extractCompatibleUsage(responseBody);
}

async function recordUsageSafely(service, context) {
  if (!service || typeof service.record !== "function") return;
  const inputTokens = Number(context.usage?.inputTokens || 0);
  const outputTokens = Number(context.usage?.outputTokens || 0);
  if (inputTokens === 0 && outputTokens === 0) return;

  try {
    await service.record({
      provider: context.provider,
      model: context.model,
      operation: context.operation,
      inputTokens,
      outputTokens,
      projectId: context.projectId,
    });
  } catch (error) {
    console.warn("ClipForge could not persist AI usage", {
      operation: context.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function cleanText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  const safe = text || fallback || "";
  return safe.length > maxLength ? `${safe.slice(0, maxLength - 1)}…` : safe;
}

function clampScore(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}
