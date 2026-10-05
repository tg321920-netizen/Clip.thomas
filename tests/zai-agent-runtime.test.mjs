import test from "node:test";
import assert from "node:assert/strict";
import { AgentRuntimeService } from "../services/agent/AgentRuntimeService.mjs";
import {
  assertAgentToolWithinRules,
  resolveAgentRules,
} from "../services/agent/AgentRules.mjs";
import {
  ZaiAgentProvider,
  resolveZaiConfig,
} from "../services/agent/providers/ZaiAgentProvider.mjs";

test("Z.ai config accepts generic aliases", () => {
  const config = resolveZaiConfig({}, {
    ZAI_API_KEY: "placeholder-key",
    ZAI_MODEL: "glm-5.3",
  });
  assert.equal(config.apiKey, "placeholder-key");
  assert.equal(config.model, "glm-5.3");
  assert.equal(config.baseUrl, "https://api.z.ai/api/paas/v4");
});

test("Z.ai rate limits become retryable agent provider errors", async () => {
  const provider = new ZaiAgentProvider({
    apiKey: "placeholder-key",
    model: "glm-5.3",
    fetchImpl: async () => ({
      ok: false,
      status: 429,
      async json() {
        return { error: { message: "rate limited" } };
      },
    }),
  });

  await assert.rejects(
    () => provider.decide(
      { objective: "test", autonomyMode: "SEMI_AUTO" },
      { tools: [] },
    ),
    (error) => {
      assert.equal(error.code, "AGENT_PROVIDER_RATE_LIMITED");
      assert.equal(error.retryable, true);
      assert.equal(error.details?.rateLimited, true);
      return true;
    },
  );
});

test("Z.ai network failures are retryable", async () => {
  const provider = new ZaiAgentProvider({
    apiKey: "placeholder-key",
    model: "glm-5.3",
    fetchImpl: async () => {
      throw new Error("socket closed");
    },
  });

  await assert.rejects(
    () => provider.decide(
      { objective: "test", autonomyMode: "SEMI_AUTO" },
      { tools: [] },
    ),
    (error) => {
      assert.equal(error.retryable, true);
      return true;
    },
  );
});

test("agent rules block disallowed source, topic, language and platform", () => {
  const rules = resolveAgentRules({
    CLIPFORGE_AGENT_RULES_JSON: JSON.stringify({
      allowedSources: ["source-ok"],
      blockedTopics: ["blocked-topic"],
      languages: ["es"],
      channels: ["YOUTUBE"],
      publishingEnabled: false,
    }),
  });

  assert.throws(
    () => assertAgentToolWithinRules(
      "research.start",
      { sourceIds: ["source-other"], topic: "news" },
      rules,
    ),
    /allowed source/i,
  );
  assert.throws(
    () => assertAgentToolWithinRules(
      "research.start",
      { sourceIds: ["source-ok"], topic: "blocked-topic update" },
      rules,
    ),
    /blocked/i,
  );
  assert.throws(
    () => assertAgentToolWithinRules("script.generate", { language: "en" }, rules),
    /language/i,
  );
  assert.throws(
    () => assertAgentToolWithinRules(
      "publishing.prepare",
      { platforms: ["FACEBOOK"] },
      rules,
    ),
    /not allowed/i,
  );
});

test("server runtime seeds one SEMI_AUTO cycle and then waits", async () => {
  const created = [];
  let records = [];
  const orchestrator = {
    async list() {
      return records;
    },
    async createTask(input) {
      const record = {
        id: "11111111-1111-4111-8111-111111111111",
        status: "QUEUED",
        task: input,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      created.push(input);
      records = [record];
      return record;
    },
    async run() {
      throw new Error("not used");
    },
  };

  const runtime = new AgentRuntimeService({
    env: {
      CLIPFORGE_AGENT_ENABLED: "true",
      CLIPFORGE_AGENT_MODE: "SEMI_AUTO",
      CLIPFORGE_AGENT_OBJECTIVE: "Prepare one safe content package.",
      CLIPFORGE_AGENT_RULES_JSON: JSON.stringify({
        maxRetries: 1,
        approvalRequired: true,
        publishingEnabled: false,
      }),
    },
    orchestrator,
  });

  const first = await runtime.ensureAutonomousCycle();
  const second = await runtime.ensureAutonomousCycle();

  assert.equal(first.reason, "created");
  assert.equal(second.reason, "active_execution");
  assert.equal(created.length, 1);
  assert.equal(created[0].autonomyMode, "SEMI_AUTO");
  assert.equal(created[0].limits.maxRetries, 1);
  assert.equal(created[0].context.agentRules.approvalRequired, true);
  assert.equal(created[0].context.agentRules.publishingEnabled, false);
});
