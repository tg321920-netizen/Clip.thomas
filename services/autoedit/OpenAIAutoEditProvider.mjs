import { AIUsageService } from "../ai/AIUsageService.mjs";
import { extractOutputText } from "../analysis/OpenAIContentProvider.mjs";
import { HeuristicAutoEditProvider } from "./HeuristicAutoEditProvider.mjs";

export class OpenAIAutoEditProvider {
  constructor(options = {}) {
    this.name = "openai-autoedit-v1";
    this.apiKey = options.apiKey ?? process.env.OPENAI_API_KEY?.trim() ?? "";
    this.model =
      options.model ??
      process.env.CLIPFORGE_AUTOEDIT_MODEL?.trim() ??
      process.env.CLIPFORGE_AI_MODEL?.trim() ??
      "";
    this.baseUrl =
      options.baseUrl ??
      process.env.OPENAI_BASE_URL?.trim() ??
      "https://api.openai.com/v1";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
    this.usageService = options.usageService ?? new AIUsageService();
  }

  async prepare({ candidates, transcript, options = {} }) {
    if (!this.apiKey) {
      throw new Error(
        "OPENAI_API_KEY is required when CLIPFORGE_AUTOEDIT_PROVIDER=openai.",
      );
    }
    if (!this.model) {
      throw new Error(
        "CLIPFORGE_AUTOEDIT_MODEL or CLIPFORGE_AI_MODEL is required for OpenAI Auto Edit.",
      );
    }
    if (typeof this.fetchImpl !== "function") {
      throw new Error("No fetch implementation is available for OpenAI Auto Edit.");
    }

    const baseline = await new HeuristicAutoEditProvider(options).prepare({
      candidates,
      transcript,
      options,
    });

    const payload = {
      model: this.model,
      store: false,
      instructions:
        "You are ClipForge Auto Edit. Choose exactly one supplied candidate ID. Never invent candidate IDs or times outside that candidate. Improve metadata without unsupported clickbait. Keep the clip understandable on its own. Return concise metadata in the video's language.",
      input: JSON.stringify({
        baseline,
        candidates: candidates.map((candidate) => ({
          candidateId: candidate.id,
          startTime: candidate.startTime,
          endTime: candidate.endTime,
          duration: candidate.duration,
          viralScore: candidate.viralScore,
          title: candidate.title,
          hook: candidate.hook,
          transcript: candidate.text,
          reasons: candidate.reasons,
        })),
      }),
      text: {
        format: {
          type: "json_schema",
          name: "clipforge_auto_edit_plan",
          strict: true,
          schema: {
            type: "object",
            properties: {
              candidateId: { type: "string" },
              startTime: { type: "number" },
              endTime: { type: "number" },
              title: { type: "string" },
              hook: { type: "string" },
              description: { type: "string" },
              hashtags: {
                type: "array",
                items: { type: "string" },
              },
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
              framingMode: {
                type: "string",
                enum: ["FILL", "FIT"],
              },
              quality: {
                type: "string",
                enum: ["FAST", "BALANCED", "HIGH"],
              },
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
      throw new Error(
        body?.error?.message ||
          body?.message ||
          `OpenAI Responses API returned HTTP ${response.status}.`,
      );
    }

    await recordUsageSafely(this.usageService, {
      body,
      model: this.model,
      operation: "AUTO_EDIT",
      projectId: transcript?.projectId || null,
    });

    const text = extractOutputText(body);
    if (!text) {
      throw new Error("OpenAI returned no structured Auto Edit output.");
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error("OpenAI returned invalid JSON for Auto Edit.");
    }
  }
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
