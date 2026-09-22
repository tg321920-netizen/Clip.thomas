import { HeuristicAutoEditProvider } from "./HeuristicAutoEditProvider.mjs";
import { OpenAIAutoEditProvider } from "./OpenAIAutoEditProvider.mjs";

export function createAutoEditProvider(options = {}) {
  const providerName = String(
    options.providerName ||
      process.env.CLIPFORGE_AUTOEDIT_PROVIDER ||
      "heuristic",
  )
    .trim()
    .toLowerCase();

  if (providerName === "heuristic") {
    return new HeuristicAutoEditProvider(options);
  }

  if (providerName === "openai") {
    return new OpenAIAutoEditProvider(options);
  }

  throw new Error(
    `Unsupported Auto Edit provider: ${providerName}. Expected heuristic or openai.`,
  );
}
