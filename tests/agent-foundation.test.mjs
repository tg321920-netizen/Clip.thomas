import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentOrchestrator } from "../services/agent/AgentOrchestrator.mjs";
import { AgentExecutionRepository } from "../services/agent/AgentExecutionRepository.mjs";
import { AgentProviderError } from "../services/agent/AgentProvider.mjs";
import { AgentToolRegistry } from "../services/agent/AgentToolRegistry.mjs";
import { normalizeAgentDecision } from "../services/agent/AgentContracts.mjs";
import { ZaiAgentProvider } from "../services/agent/providers/ZaiAgentProvider.mjs";

async function withStorage(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-agent-"));
  const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
  const previousPublishing = process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  delete process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
  try {
    await fn(root);
  } finally {
    if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
    if (previousPublishing === undefined) delete process.env.CLIPFORGE_AGENT_REAL_PUBLISHING;
    else process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = previousPublishing;
    await rm(root, { recursive: true, force: true });
  }
}

function sequenceProvider(values) {
  let index = 0;
  return {
    async decide() {
      const value = values[Math.min(index, values.length - 1)];
      index += 1;
      if (value instanceof Error) throw value;
      return value;
    },
  };
}

function fakeTools(options = {}) {
  const calls = [];
  return {
    calls,
    listDefinitions() {
      return [
        { name: "test.echo", description: "echo", inputHint: {} },
        { name: "test.fail", description: "fail", inputHint: {} },
        { name: "publishing.schedule", description: "schedule", inputHint: {} },
        { name: "publishing.publish", description: "publish", inputHint: {} },
      ];
    },
    async execute(name, input) {
      calls.push({ name, input });
      if (name === "test.fail") {
        const error = new Error("temporary failure");
        error.code = "TEMPORARY";
        error.retryable = true;
        throw error;
      }
      return options.result || { ok: true, input };
    },
  };
}

test("agent tool allowlist rejects arbitrary shell-like tools", async () => {
  const registry = new AgentToolRegistry();
  await assert.rejects(
    () => registry.execute("shell.exec", { command: "rm -rf /" }),
    /not allowed/i,
  );
});

test("agent decision parser rejects invalid tool decisions", () => {
  assert.throws(
    () => normalizeAgentDecision({ type: "TOOL", input: {} }),
    /valid tool name/i,
  );
  assert.equal(
    normalizeAgentDecision({ type: "COMPLETE", output: { ok: true } }).type,
    "COMPLETE",
  );
});

test("MANUAL waits for approval before executing a tool", async () => {
  await withStorage(async () => {
    const tools = fakeTools();
    const provider = sequenceProvider([
      { type: "TOOL", tool: "test.echo", input: { value: 1 } },
      { type: "COMPLETE", output: { done: true } },
    ]);
    const agent = new AgentOrchestrator({ provider, tools });
    const created = await agent.createTask({
      objective: "test manual approval",
      autonomyMode: "MANUAL",
    });
    let execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_APPROVAL");
    assert.equal(tools.calls.length, 0);

    await agent.approve(created.id);
    execution = await agent.run(created.id);
    assert.equal(execution.status, "COMPLETED");
    assert.equal(tools.calls.length, 1);
  });
});

test("SEMI_AUTO requires approval for social scheduling", async () => {
  await withStorage(async () => {
    process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = "true";
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "publishing.schedule", input: { publicationId: "x" } },
      ]),
      tools,
    });
    const created = await agent.createTask({
      objective: "schedule after review",
      autonomyMode: "SEMI_AUTO",
    });
    const execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_APPROVAL");
    assert.equal(tools.calls.length, 0);
  });
});

test("AUTO cannot publish while real publishing flag is OFF", async () => {
  await withStorage(async () => {
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "publishing.publish", input: { publicationIds: [] } },
      ]),
      tools,
    });
    const created = await agent.createTask({
      objective: "publish",
      autonomyMode: "AUTO",
    });
    const execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_INFORMATION");
    assert.match(execution.error, /publishing is disabled/i);
    assert.equal(tools.calls.length, 0);
  });
});

test("AUTO executes allowed tools and stops on COMPLETE", async () => {
  await withStorage(async () => {
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "test.echo", input: { value: "a" } },
        { type: "COMPLETE", output: { done: true } },
      ]),
      tools,
    });
    const created = await agent.createTask({
      objective: "auto safe task",
      autonomyMode: "AUTO",
    });
    const execution = await agent.run(created.id);
    assert.equal(execution.status, "COMPLETED");
    assert.equal(execution.stepCount, 1);
    assert.equal(tools.calls.length, 1);
  });
});

test("maxSteps terminates a runaway agent", async () => {
  await withStorage(async () => {
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "test.echo", input: {} },
      ]),
      tools,
    });
    const created = await agent.createTask({
      objective: "bounded loop",
      autonomyMode: "AUTO",
      limits: { maxSteps: 2 },
    });
    const execution = await agent.run(created.id);
    assert.equal(execution.status, "FAILED");
    assert.equal(execution.stepCount, 2);
    assert.match(execution.error, /maxSteps/i);
  });
});

test("retryable tool failures use bounded exponential retries", async () => {
  await withStorage(async () => {
    let now = Date.parse("2026-10-01T00:00:00.000Z");
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "test.fail", input: {} },
      ]),
      tools,
      now: () => new Date(now),
    });
    const created = await agent.createTask({
      objective: "retry safely",
      autonomyMode: "AUTO",
      limits: { maxRetries: 2, baseBackoffMs: 1000 },
    });

    let execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_RETRY");
    assert.equal(execution.retryCount, 1);

    now += 1000;
    execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_RETRY");
    assert.equal(execution.retryCount, 2);

    now += 2000;
    execution = await agent.run(created.id);
    assert.equal(execution.status, "FAILED");
    assert.equal(tools.calls.length, 3);
  });
});

test("agent execution state survives repository re-instantiation", async () => {
  await withStorage(async () => {
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "test.echo", input: {} },
      ]),
      tools,
    });
    const created = await agent.createTask({
      objective: "persist state",
      autonomyMode: "MANUAL",
    });
    await agent.run(created.id);

    const reloaded = await new AgentExecutionRepository().get(created.id);
    assert.equal(reloaded.status, "WAITING_APPROVAL");
    assert.equal(reloaded.id, created.id);
  });
});

test("provider failure falls back to a safe waiting state", async () => {
  await withStorage(async () => {
    const failure = new AgentProviderError("model unavailable", {
      code: "MODEL_UNAVAILABLE",
      retryable: false,
    });
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([failure]),
      tools: fakeTools(),
    });
    const created = await agent.createTask({
      objective: "safe provider fallback",
      autonomyMode: "AUTO",
    });
    const execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_INFORMATION");
    assert.match(execution.error, /model unavailable/i);
  });
});

test("Z.ai provider without credentials never makes an external request", async () => {
  await withStorage(async () => {
    let fetched = false;
    const provider = new ZaiAgentProvider({
      apiKey: "",
      model: "",
      fetchImpl: async () => {
        fetched = true;
        throw new Error("must not be called");
      },
    });
    const agent = new AgentOrchestrator({
      provider,
      tools: fakeTools(),
    });
    const created = await agent.createTask({
      objective: "credentials guard",
      autonomyMode: "AUTO",
    });
    const execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_INFORMATION");
    assert.equal(fetched, false);
  });
});


test("approval never bypasses a hard publishing guard", async () => {
  await withStorage(async () => {
    process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = "true";
    const tools = fakeTools();
    const agent = new AgentOrchestrator({
      provider: sequenceProvider([
        { type: "TOOL", tool: "publishing.publish", input: { publicationIds: [] } },
      ]),
      tools,
    });
    const created = await agent.createTask({
      objective: "verify guarded publishing",
      autonomyMode: "MANUAL",
    });

    let execution = await agent.run(created.id);
    assert.equal(execution.status, "WAITING_APPROVAL");
    assert.equal(tools.calls.length, 0);

    process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = "false";
    await agent.approve(created.id);
    execution = await agent.run(created.id);

    assert.equal(execution.status, "WAITING_INFORMATION");
    assert.match(execution.error, /publishing is disabled/i);
    assert.equal(tools.calls.length, 0);
  });
});
