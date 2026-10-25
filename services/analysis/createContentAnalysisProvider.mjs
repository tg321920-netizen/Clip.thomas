import { OpenAIContentProvider } from "./OpenAIContentProvider.mjs";
import { TranscriptCandidateProvider } from "./TranscriptCandidateProvider.mjs";
import { resolveZaiConfig } from "../agent/providers/ZaiAgentProvider.mjs";

export function createContentAnalysisProvider(options = {}) {
  const env = options.env || process.env;
  const providerName = String(
    options.providerName ||
      env.CLIPFORGE_ANALYSIS_PROVIDER ||
      "heuristic",
  )
    .trim()
    .toLowerCase();

  if (providerName === "heuristic") {
    return new TranscriptCandidateProvider(options);
  }

  if (providerName === "zai") {
    const config = resolveZaiConfig({ ...options, model: options.model || env.CLIPFORGE_EDITOR_MODEL || env.CLIPFORGE_ZAI_MODEL || env.ZAI_MODEL || "glm-4.6v-flash", maxOutputTokens: 4096 }, env);
    return new OpenAIContentProvider({ ...options, ...config, name: "zai-editor-v1", strictSelection: true,
      visionEnabled: options.visionEnabled ?? env.CLIPFORGE_EDITOR_VISION === "true" });
  }

  if (["openai", "compatible", "openai-compatible"].includes(providerName)) {
    return new OpenAIContentProvider({
      ...options,
      model: options.model || env.CLIPFORGE_AI_MODEL?.trim(),
    });
  }

  throw new Error(
    `Unsupported content analysis provider: ${providerName}. Expected heuristic, zai, openai, or openai-compatible.`,
  );
}
