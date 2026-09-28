import { AIUsageService } from "../usage/AIUsageService.mjs";
import {
  requestStructuredJson,
  resolveOpenAICompatibleConfig,
} from "../ai/OpenAICompatibleClient.mjs";
import { HeuristicAutoEditProvider } from "./HeuristicAutoEditProvider.mjs";

export class OpenAIAutoEditProvider {
  constructor(options = {}) {
    this.config = resolveOpenAICompatibleConfig({
      ...options,
      model:
        options.model ??
        process.env.CLIPFORGE_AUTOEDIT_MODEL?.trim() ??
        process.env.CLIPFORGE_AI_MODEL?.trim(),
    });
    this.name = `openai-compatible-autoedit-${this.config.apiStyle}-v1`;
    this.apiKey = this.config.apiKey;
    this.model = this.config.model;
    this.baseUrl = this.config.baseUrl;
    this.apiStyle = this.config.apiStyle;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.usage = options.usageService ?? new AIUsageService();
    this.preferredCandidateId = options.candidateId || null;
  }

  async prepare({ project, candidates, transcript, options = {} }) {
    const requestedCandidateId = options.candidateId || this.preferredCandidateId;
    const eligibleCandidates = requestedCandidateId
      ? candidates.filter((candidate) => candidate.id === requestedCandidateId)
      : candidates;

    if (!Array.isArray(eligibleCandidates) || eligibleCandidates.length === 0) {
      throw new Error("Auto Edit received an unknown or empty candidate selection.");
    }

    const baseline = await new HeuristicAutoEditProvider({
      ...options,
      candidateId: requestedCandidateId,
    }).prepare({
      candidates: eligibleCandidates,
      transcript,
      options: { ...options, candidateId: requestedCandidateId },
    });

    const schema = {
      type: "object",
      properties: {
        candidateId: { type: "string" },
        startTime: { type: "number" },
        endTime: { type: "number" },
        title: { type: "string" },
        hook: { type: "string" },
        description: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        onScreenText: { type: "string" },
        recommendedPlatforms: {
          type: "array",
          items: {
            type: "string",
            enum: ["TIKTOK", "YOUTUBE", "FACEBOOK"],
          },
        },
        subtitleStyle: {
          type: "string",
          enum: ["CLEAN", "VIRAL", "KARAOKE"],
        },
        framingMode: { type: "string", enum: ["FILL", "FIT"] },
        quality: { type: "string", enum: ["FAST", "BALANCED", "HIGH"] },
        reason: { type: "string" },
      },
      required: [
        "candidateId",
        "startTime",
        "endTime",
        "title",
        "hook",
        "description",
        "hashtags",
        "onScreenText",
        "recommendedPlatforms",
        "subtitleStyle",
        "framingMode",
        "quality",
        "reason",
      ],
      additionalProperties: false,
    };

    const result = await requestStructuredJson({
      config: this.config,
      name: "clipforge_auto_edit_plan",
      schema,
      instructions:
        "You are ClipForge Auto Edit. Use only a supplied candidate ID. Never invent candidate IDs or times outside that candidate. Improve metadata without unsupported clickbait or fake engagement claims. Keep the clip understandable on its own. If only one candidate is supplied, you must use that candidate. Return concise metadata in the video's language.",
      input: {
        baseline,
        candidates: eligibleCandidates.map((candidate) => ({
          candidateId: candidate.id,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          duration: candidate.duration,
          viralScore: candidate.viralScore,
          scoreComponents: candidate.components,
          title: candidate.title,
          hook: candidate.hook,
          transcript: candidate.text,
          reasons: candidate.reasons,
        })),
      },
      fetchImpl: this.fetchImpl,
    });

    await recordUsageSafely(this.usage, {
      usage: result.usage,
      provider: this.apiStyle === "responses" ? "openai" : this.name,
      model: this.model,
      projectId: project?.id || project?.projectId || null,
    });

    return result.parsed;
  }
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
      operation: "auto-edit",
      inputTokens,
      outputTokens,
      projectId: context.projectId,
    });
  } catch (error) {
    console.warn("ClipForge could not persist AI usage", {
      operation: "auto-edit",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
