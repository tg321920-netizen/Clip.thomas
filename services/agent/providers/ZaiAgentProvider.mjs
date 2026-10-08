import { resolveOpenAICompatibleConfig } from "../../ai/OpenAICompatibleClient.mjs";
import { CompatibleAgentProvider } from "./CompatibleAgentProvider.mjs";

export class ZaiAgentProvider extends CompatibleAgentProvider {
  constructor(options = {}) {
    super({ ...options, config: resolveZaiConfig(options) });
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

