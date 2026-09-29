import { JobStore } from "../services/JobStore.mjs";
import { OwnedContentWorkflowRunner } from "../services/owned-content/OwnedContentWorkflowRunner.mjs";
import { WorkflowService } from "../services/workflows/WorkflowService.mjs";

const once = process.argv.includes("--once");
const pollMs = Number(process.env.CLIPFORGE_WORKER_POLL_MS || 2000);
const store = new JobStore();
const workflows = new WorkflowService();
const runner = new OwnedContentWorkflowRunner({ workflows });
let stopping = false;

process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge Owned Content worker started.");
while (!stopping) {
  const job = await store.claimNext(["OWNED_CONTENT"]);
  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  try {
    await store.updateProgress(job.id, 10);
    let execution = await workflows.getExecution(job.projectId);
    if (!execution) throw new Error("Owned-content execution not found.");
    if (execution.status === "waiting_information") execution = await workflows.resumeExecution(execution.id);
    const result = await runner.run(execution.id, { maxSteps: 20 });
    const status = result.execution?.status;
    if (!["waiting_approval", "completed"].includes(status)) {
      throw new Error(`Owned-content worker stopped in unexpected execution status ${status || "unknown"}.`);
    }
    await store.complete({
      ...job,
      result: {
        executionId: execution.id,
        executionStatus: status,
        approvalId: result.approval?.id || null,
        currentStepId: result.execution?.currentStepId || null,
      },
    });
    console.log("Owned Content media stage completed", { executionId: execution.id, status });
  } catch (error) {
    const failed = await store.fail(job, error);
    console.error("Owned Content worker failed", {
      executionId: job.projectId,
      status: failed.status,
      attempts: failed.attempts,
      error: failed.error,
    });
  }

  if (once) break;
}
console.log("ClipForge Owned Content worker stopped.");

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
