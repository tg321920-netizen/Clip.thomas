import {
  requestStructuredJson,
  resolveOpenAICompatibleConfig,
} from "../../ai/OpenAICompatibleClient.mjs";
import { AgentProvider, AgentProviderError } from "../AgentProvider.mjs";
import { normalizeAgentDecision, sanitizeAgentValue } from "../AgentContracts.mjs";

const DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "tool", "input", "rationale", "output", "reason"],
  properties: {
    type: {
      type: "string",
      enum: ["TOOL", "COMPLETE", "WAITING_INFORMATION", "WAITING_APPROVAL"],
    },
    tool: { anyOf: [{ type: "string" }, { type: "null" }] },
    input: { type: "object", additionalProperties: true },
    rationale: { anyOf: [{ type: "string" }, { type: "null" }] },
    output: { type: "object", additionalProperties: true },
    reason: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};

export class ZaiAgentProvider extends AgentProvider {
  constructor(options = {}) {
    super();
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.config = resolveZaiConfig(options);
  }

  isConfigured() {
    return Boolean(this.config.apiKey && this.config.model);
  }

  async decide(task, context = {}) {
    if (!this.config.apiKey) {
      throw new AgentProviderError(
        "CLIPFORGE_ZAI_API_KEY (or ZAI_API_KEY) is not configured.",
        {
          code: "AGENT_PROVIDER_NOT_CONFIGURED",
          retryable: false,
          waitingInformation: true,
        },
      );
    }
    if (!this.config.model) {
      throw new AgentProviderError(
        "CLIPFORGE_ZAI_MODEL (or ZAI_MODEL) is not configured.",
        {
          code: "AGENT_PROVIDER_NOT_CONFIGURED",
          retryable: false,
          waitingInformation: true,
        },
      );
    }

    try {
      const result = await requestStructuredJson({
        config: this.config,
        name: "clipforge_agent_decision",
        schema: DECISION_SCHEMA,
        instructions: [
          "You are the decision engine inside ClipForge.",
          "Choose only from the tools supplied in context.tools.",
          "Never request shell access, credentials, filesystem access, infrastructure changes, payments, or direct social-platform API calls.",
          "Use one tool at a time. Return COMPLETE when the objective is satisfied.",
          "If required information is missing, return WAITING_INFORMATION.",
          "If human approval is appropriate, return WAITING_APPROVAL.",
          "Do not invent analytics conclusions when evidence is insufficient.",
        ].join("\n"),
        input: {
          task: sanitizeAgentValue(task),
          context: sanitizeAgentValue(context),
        },
        fetchImpl: this.fetchImpl,
      });
      return normalizeAgentDecision(result.parsed);
    } catch (error) {
      if (error instanceof AgentProviderError) throw error;

      const status = Number(error?.status);
      const rateLimited = error?.rateLimited === true || status === 429;
      const retryable = error?.retryable === true;
      const code = rateLimited
        ? "AGENT_PROVIDER_RATE_LIMITED"
        : String(error?.code || "AGENT_PROVIDER_REQUEST_FAILED");

      throw new AgentProviderError(
        redactProviderMessage(error, this.config.apiKey),
        {
          code,
          retryable,
          details: {
            status: Number.isFinite(status) ? status : null,
            rateLimited,
          },
        },
      );
    }
  }
}

export function resolveZaiConfig(options = {}, env = process.env) {
  const apiKey = String(
    options.apiKey ??
      env.CLIPFORGE_ZAI_API_KEY ??
      env.ZAI_API_KEY ??
      "",
  ).trim();
  const model = String(
    options.model ??
      env.CLIPFORGE_ZAI_MODEL ??
      env.ZAI_MODEL ??
      "",
  ).trim();
  const baseUrl = String(
    options.baseUrl ??
      env.CLIPFORGE_ZAI_BASE_URL ??
      env.ZAI_BASE_URL ??
      "https://api.z.ai/api/paas/v4",
  ).trim();
  const apiStyle = String(
    options.apiStyle ?? env.CLIPFORGE_ZAI_API_STYLE ?? "chat-completions",
  ).trim();

  return resolveOpenAICompatibleConfig({
    apiKey,
    model,
    baseUrl,
    apiStyle,
    temperature: options.temperature ?? env.CLIPFORGE_ZAI_TEMPERATURE ?? 0.2,
    maxOutputTokens:
      options.maxOutputTokens ?? env.CLIPFORGE_ZAI_MAX_OUTPUT_TOKENS ?? 1400,
    timeoutMs:
      options.timeoutMs ??
      env.CLIPFORGE_ZAI_TIMEOUT_MS ??
      env.ZAI_TIMEOUT_MS ??
      60_000,
  });
}

function redactProviderMessage(error, apiKey) {
  let message = error instanceof Error ? error.message : String(error);
  const secret = String(apiKey || "");
  if (secret) message = message.split(secret).join("[REDACTED]");
  return message.slice(0, 2000);
}
