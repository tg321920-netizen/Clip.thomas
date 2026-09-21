import { OpenAIContentProvider } from "./OpenAIContentProvider.mjs";
import { TranscriptCandidateProvider } from "./TranscriptCandidateProvider.mjs";

export function createContentAnalysisProvider(options = {}) {
  const providerName = String(
    options.providerName ||
      process.env.CLIPFORGE_ANALYSIS_PROVIDER ||
      "heuristic",
  )
    .trim()
    .toLowerCase();

  if (providerName === "heuristic") {
    return new TranscriptCandidateProvider(options);
  }

  if (providerName === "openai") {
    return new OpenAIContentProvider({
      ...options,
      model: options.model || process.env.CLIPFORGE_AI_MODEL?.trim(),
    });
  }

  throw new Error(
    `Unsupported content analysis provider: ${providerName}. Expected heuristic or openai.`,
  );
}
