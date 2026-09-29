import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WorkflowService } from "../services/workflows/WorkflowService.mjs";

const PROJECT_ID = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-workflows-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;

  try {
    await fn(root);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

async function createMarketingWorkflow(service, name = "MetaBot marketing") {
  return service.createWorkflow({
    name,
    projectId: PROJECT_ID,
    steps: [
      { type: "SOURCE" },
      { type: "EXTRACT", maxAttempts: 3 },
      { type: "APPROVAL", name: "Human approval" },
      { type: "PUBLISH" },
      { type: "ANALYTICS" },
    ],
  });
}

test("workflow execution resumes from the failed step instead of restarting", async () => {
  await withStorage(async () => {
    const service = new WorkflowService();
    const workflow = await createMarketingWorkflow(service);
    const { execution: created } = await service.createExecution(workflow.id, {
      input: { brief: "Create a campaign" },
    });

    let execution = await service.startCurrentStep(created.id);
    assert.equal(execution.currentStepId, "source-1");
    assert.equal(execution.status, "processing");

    execution = await service.completeCurrentStep(created.id, { sourceId: "source-1" });
    assert.equal(execution.currentStepId, "extract-2");
    assert.equal(execution.results["source-1"].sourceId, "source-1");

    execution = await service.startCurrentStep(created.id);
    assert.equal(execution.steps[1].attempts, 1);

    execution = await service.failCurrentStep(created.id, "Temporary extractor error");
    assert.equal(execution.status, "queued");
    assert.equal(execution.currentStepId, "extract-2");
    assert.equal(execution.steps[0].status, "completed");
    assert.equal(execution.steps[0].attempts, 1);

    execution = await service.startCurrentStep(created.id);
    assert.equal(execution.steps[1].attempts, 2);
    execution = await service.completeCurrentStep(created.id, { facts: ["price", "benefit"] });

    assert.equal(execution.currentStepId, "approval-3");
    assert.equal(execution.steps[0].attempts, 1);
    assert.equal(execution.steps[1].status, "completed");
  });
});

test("approval is a hard pause and continues only after explicit approval", async () => {
  await withStorage(async () => {
    const service = new WorkflowService();
    const workflow = await service.createWorkflow({
      name: "Approval gate",
      projectId: PROJECT_ID,
      steps: [
        { type: "APPROVAL" },
        { type: "PUBLISH" },
      ],
    });
    const { execution: created } = await service.createExecution(workflow.id);

    let execution = await service.startCurrentStep(created.id);
    assert.equal(execution.status, "waiting_approval");
    assert.equal(execution.steps[0].status, "waiting_approval");

    execution = await service.approveExecution(created.id, { approvedBy: "owner" });
    assert.equal(execution.status, "queued");
    assert.equal(execution.currentStepId, "publish-2");
    assert.equal(execution.results["approval-1"].approved, true);

    execution = await service.startCurrentStep(created.id);
    assert.equal(execution.status, "publishing");
  });
});

test("idempotency key prevents duplicate executions within the same workflow", async () => {
  await withStorage(async () => {
    const service = new WorkflowService();
    const workflow = await createMarketingWorkflow(service);

    const first = await service.createExecution(workflow.id, {
      idempotencyKey: "metabot-hotels-2026-09-28",
    });
    const second = await service.createExecution(workflow.id, {
      idempotencyKey: "metabot-hotels-2026-09-28",
    });

    assert.equal(first.reused, false);
    assert.equal(second.reused, true);
    assert.equal(first.execution.id, second.execution.id);
  });
});

test("the same idempotency key can be used by different workflows", async () => {
  await withStorage(async () => {
    const service = new WorkflowService();
    const firstWorkflow = await createMarketingWorkflow(service, "MetaBot hotels");
    const secondWorkflow = await createMarketingWorkflow(service, "MetaBot restaurants");

    const first = await service.createExecution(firstWorkflow.id, {
      idempotencyKey: "campaign-2026-09-28",
    });
    const second = await service.createExecution(secondWorkflow.id, {
      idempotencyKey: "campaign-2026-09-28",
    });

    assert.equal(first.reused, false);
    assert.equal(second.reused, false);
    assert.notEqual(first.execution.id, second.execution.id);
    assert.notEqual(first.execution.workflowId, second.execution.workflowId);
  });
});

test("manual resume requeues only the terminal failed step", async () => {
  await withStorage(async () => {
    const service = new WorkflowService();
    const workflow = await service.createWorkflow({
      name: "Manual retry",
      projectId: PROJECT_ID,
      steps: [
        { type: "SOURCE" },
        { type: "EXTRACT", maxAttempts: 1 },
      ],
    });
    const { execution: created } = await service.createExecution(workflow.id);

    await service.startCurrentStep(created.id);
    await service.completeCurrentStep(created.id, { ok: true });
    await service.startCurrentStep(created.id);
    let execution = await service.failCurrentStep(created.id, "Permanent failure");

    assert.equal(execution.status, "failed");
    assert.equal(execution.currentStepId, "extract-2");
    assert.equal(execution.steps[0].status, "completed");

    execution = await service.resumeExecution(created.id);
    assert.equal(execution.status, "queued");
    assert.equal(execution.currentStepId, "extract-2");
    assert.equal(execution.steps[0].status, "completed");
    assert.equal(execution.steps[1].attempts, 0);
  });
});
