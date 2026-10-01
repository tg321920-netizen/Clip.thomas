import { AgentRuntimeService } from "../services/agent/AgentRuntimeService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  1000,
  Math.min(Number(process.env.CLIPFORGE_AGENT_POLL_MS || 10000), 300000),
);
const runtime = new AgentRuntimeService();
let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge Agent worker started.");

while (!stopping) {
  try {
    const result = await runtime.runDue();
    if (result.enabled && result.processed > 0) {
      console.log("Agent worker processed executions", {
        processed: result.processed,
        states: result.executions.map((execution) => ({
          id: execution.id,
          status: execution.status,
        })),
      });
    }
  } catch (error) {
    console.error("Agent worker cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (once) break;
  await sleep(pollMs);
}

console.log("ClipForge Agent worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
