import test from "node:test";
import assert from "node:assert/strict";
import { createAgentProvider, resolveAgentProviderConfig } from "../services/agent/providers/createAgentProvider.mjs";

test("Gemini selection never reuses the Z.ai credential or endpoint", () => {
  const config = resolveAgentProviderConfig({}, {
    CLIPFORGE_AGENT_PROVIDER: "gemini",
    CLIPFORGE_GEMINI_API_KEY: "gemini-test-key",
    CLIPFORGE_ZAI_API_KEY: "zai-test-key",
    CLIPFORGE_ZAI_BASE_URL: "https://api.z.ai/api/paas/v4",
  });
  assert.equal(config.apiKey, "gemini-test-key");
  assert.equal(config.baseUrl, "https://generativelanguage.googleapis.com/v1beta/openai");
  assert.equal(config.model, "gemini-3.5-flash-lite");
  assert.equal(resolveAgentProviderConfig({}, { CLIPFORGE_AGENT_PROVIDER: "gemini", CLIPFORGE_ZAI_API_KEY: "old" }).apiKey, "");
});

test("Gemini produces validated allowlist decisions and redacts provider errors", async () => {
  let fail = false;
  const provider = createAgentProvider({
    env: { CLIPFORGE_AGENT_PROVIDER: "gemini", CLIPFORGE_GEMINI_API_KEY: "gemini-test-key" },
    fetchImpl: async (url, init) => {
      assert.match(url, /^https:\/\/generativelanguage.googleapis.com\//);
      assert.equal(init.headers.Authorization, "Bearer gemini-test-key");
      if (fail) return { ok: false, status: 403, json: async () => ({ error: { message: "Rejected gemini-test-key" } }) };
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify({ type: "TOOL", tool: "channels.status", input: {}, output: {}, reason: null, rationale: "Check OAuth" }) } }] }) };
    },
  });
  const decision = await provider.decide({ objective: "Check YouTube" }, { tools: [] });
  assert.equal(decision.tool, "channels.status");
  fail = true;
  await assert.rejects(() => provider.decide({ objective: "Check" }), error => {
    assert.doesNotMatch(error.message, /gemini-test-key/);
    assert.match(error.message, /REDACTED/);
    return true;
  });
});
