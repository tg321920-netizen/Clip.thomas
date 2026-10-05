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
        states: result.executions.map(safeExecutionState),
      });
    } else if (result.enabled) {
      const paused = await runtime.listExecutions({
        status: ["WAITING_INFORMATION", "WAITING_APPROVAL"],
      });
      if (paused.length > 0) {
        console.log("Agent worker paused execution", safeExecutionState(paused[0]));
      }
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


function lastAgentCode(execution) {
  const history = Array.isArray(execution?.history) ? execution.history : [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const code = history[index]?.data?.code;
    if (code) return String(code).slice(0, 120);
  }
  return null;
}


function safeExecutionState(execution) {
  return {
    id: execution?.id || null,
    status: execution?.status || null,
    code: lastAgentCode(execution),
    error: execution?.error ? String(execution.error).slice(0, 500) : null,
  };
}
