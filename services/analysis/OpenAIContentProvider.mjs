import { AIUsageService } from "../ai/AIUsageService.mjs";
import { TranscriptCandidateProvider } from "./TranscriptCandidateProvider.mjs";

export class OpenAIContentProvider {
  constructor(options = {}) {
    this.name = "openai-responses-v1";
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? "";
    this.model = options.model ?? process.env.CLIPFORGE_AI_MODEL?.trim() ?? "";
    this.baseUrl =
      options.baseUrl ??
      process.env.OPENAI_BASE_URL?.trim() ??
      "https://api.openai.com/v1";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.usageService = options.usageService ?? new AIUsageService();
  }

  async analyze({ transcript, options = {} }) {
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required when CLIPFORGE_ANALYSIS_PROVIDER=openai.",
      );
    }
    if (!this.model) {
      throw new Error(
        "CLIPFORGE_AI_MODEL is required when CLIPFORGE_ANALYSIS_PROVIDER=openai.",
      );
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation is available for the OpenAI provider.");
    }

    const maxCandidates = Math.max(1, Number(options.maxCandidates || 10));
    const baselineProvider = new TranscriptCandidateProvider({
      ...options,
      maxCandidates: Math.min(30, Math.max(maxCandidates * 3, maxCandidates)),
    });

    const baseline = await baselineProvider.analyze({ transcript, options });

    const payload = {
      model: this.model,
      store: false,
      instructions:
        "You are ClipForge's content-selection engine. Select the strongest short-form candidates only from the supplied candidate IDs. Never invent timestamps or candidate IDs. Prefer clear hooks, emotional or surprising moments, self-contained context, and shareable ideas. Return concise Spanish metadata unless the transcript is clearly in another language.",
      input: JSON.stringify({
        maxCandidates,
        candidates: baseline.map((candidate) => ({
          candidateId: candidate.id,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          duration: candidate.duration,
          transcript: candidate.text,
          baselineViralScore: candidate.viralScore,
          baselineReasons: candidate.reasons,
        })),
      }),
      text: {
        format: {
          type: "json_schema",
          name: "clipforge_candidate_selection",
          strict: true,
          schema: {
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
                    relevanceScore: {
                      type: "integer",
                      minimum: 0,
                      maximum: 100,
                    },
                  },
                  required: [
                    "candidateId",
                    "title",
                    "hook",
                    "reason",
                    "relevanceScore",
                  ],
                  additionalProperties: false,
                },
              },
            },
            required: ["selections"],
            additionalProperties: false,
          },
        },
      },
    };

    const response = await this.fetchImpl(
      `${this.baseUrl.replace(/\/$/, "")}/responses`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    const body = await readJsonResponse(response);

    if (!response.ok) {
      const message =
        body?.error?.message ||
        body?.message ||
        `OpenAI Responses API returned HTTP ${response.status}.`;
      throw new Error(message);
    }

    await recordUsageSafely(this.usageService, {
      body,
      model: this.model,
      operation: "ANALYZE_CONTENT",
      projectId: transcript?.projectId || null,
    });

    const text = extractOutputText(body);
    if (!text) {
      throw new Error("OpenAI returned no structured text output.");
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("OpenAI returned invalid JSON for candidate selection.");
    }

    const selectedIds = new Set();
    const selected = [];

    for (const item of Array.isArray(parsed?.selections) ? parsed.selections : []) {
      if (selected.length >= maxCandidates) break;
      if (!item || typeof item.candidateId !== "string") continue;
      if (selectedIds.has(item.candidateId)) continue;

      const candidate = baseline.find(
        (entry) => entry.id === item.candidateId,
      );
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
      throw new Error("OpenAI did not return any valid candidate selections.");
    }

    return selected;
  }
}

export function extractOutputText(responseBody) {
  if (typeof responseBody?.output_text === "string") {
    return responseBody.output_text.trim();
  }

  const output = Array.isArray(responseBody?.output) ? responseBody.output : [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        return part.text.trim();
      }
    }
  }

  return "";
}

async function recordUsageSafely(service, input) {
  if (!service || typeof service.recordOpenAIResponse !== "function") return;
  try {
    await service.recordOpenAIResponse(input);
  } catch (error) {
    console.warn("OpenAI usage accounting failed", {
      operation: input.operation,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch {
    return {};
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
