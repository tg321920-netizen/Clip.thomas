import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AutopilotService, normalizeConfig } from "../services/autopilot/AutopilotService.mjs";
import { ChannelService } from "../services/channels/ChannelService.mjs";
import { WorkflowService } from "../services/workflows/WorkflowService.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-autonomy-"));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    await fn();
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("legacy AUTOPILOT config maps to AUTO without breaking existing setups", () => {
  const config = normalizeConfig({
    enabled: true,
    mode: "AUTOPILOT",
    approvalRequired: false,
  });
  assert.equal(config.mode, "AUTO");
  assert.equal(config.approvalRequired, false);
});

test("SEMI_AUTO always preserves publication approval", () => {
  const config = normalizeConfig({
    enabled: true,
    mode: "SEMI_AUTO",
    approvalRequired: false,
  });
  assert.equal(config.mode, "SEMI_AUTO");
  assert.equal(config.approvalRequired, true);
});

test("workflow and channel persist explicit agent autonomy modes", async () => {
  await withStorage(async () => {
    const workflows = new WorkflowService();
    const workflow = await workflows.createWorkflow({
      name: "Agent workflow",
      autonomyMode: "AUTO",
      steps: [{ id: "agent-1", type: "AGENT_DECISION" }],
    });
    const created = await workflows.createExecution(workflow.id);
    assert.equal(workflow.autonomyMode, "AUTO");
    assert.equal(created.execution.autonomyMode, "AUTO");

    const channels = new ChannelService();
    const channel = await channels.createChannel({
      platform: "YOUTUBE",
      name: "YouTube",
      timezone: "UTC",
      strategy: { agentAutonomyMode: "SEMI_AUTO" },
    });
    assert.equal(channel.strategy.agentAutonomyMode, "SEMI_AUTO");
  });
});

test("Autopilot defaults remain manual and disabled", async () => {
  await withStorage(async () => {
    const config = await new AutopilotService().getConfig();
    assert.equal(config.mode, "MANUAL");
    assert.equal(config.enabled, false);
    assert.equal(config.approvalRequired, true);
  });
});
