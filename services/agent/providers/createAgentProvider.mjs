import { resolveOpenAICompatibleConfig } from "../../ai/OpenAICompatibleClient.mjs";
import { CompatibleAgentProvider } from "./CompatibleAgentProvider.mjs";
import { resolveZaiConfig } from "./ZaiAgentProvider.mjs";

export function resolveAgentProviderConfig(options = {}, env = process.env) {
  const provider = String(env.CLIPFORGE_AGENT_PROVIDER || "zai").trim().toLowerCase();
  if (provider === "zai") return resolveZaiConfig(options, env);
  if (provider !== "gemini") throw new Error("Unsupported CLIPFORGE_AGENT_PROVIDER.");
  return resolveOpenAICompatibleConfig({
    apiKey: options.apiKey ?? env.CLIPFORGE_GEMINI_API_KEY ?? env.GEMINI_API_KEY ?? "",
    model: options.model ?? env.CLIPFORGE_GEMINI_MODEL ?? "gemini-3.5-flash-lite",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiStyle: "chat-completions",
    temperature: options.temperature ?? 0.2,
    maxOutputTokens: options.maxOutputTokens ?? 4096,
    timeoutMs: options.timeoutMs ?? 60000,
  });
}

export function createAgentProvider(options = {}) {
  return new CompatibleAgentProvider({
    ...options,
    config: resolveAgentProviderConfig(options, options.env || process.env),
  });
}
