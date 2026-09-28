import test from "node:test";
import assert from "node:assert/strict";
import {
  requestStructuredJson,
  resolveOpenAICompatibleConfig,
} from "../services/ai/OpenAICompatibleClient.mjs";

const schema = {
  type: "object",
  properties: { answer: { type: "string" } },
  required: ["answer"],
  additionalProperties: false,
};

test("non-OpenAI base URLs default to Chat Completions and parse compatible usage", async () => {
  const calls = [];
  const config = resolveOpenAICompatibleConfig({
    apiKey: "test-secret",
    baseUrl: "https://openrouter.example/api/v1/",
    model: "vendor/model",
  });

  assert.equal(config.apiStyle, "chat-completions");

  const result = await requestStructuredJson({
    config,
    name: "test_schema",
    schema,
    instructions: "Return the requested object.",
    input: { prompt: "hola" },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [
              { message: { content: '{"answer":"ok"}' } },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 4 },
          };
        },
      };
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://openrouter.example/api/v1/chat/completions");
  assert.equal(calls[0].init.headers.Authorization, "Bearer test-secret");
  const request = JSON.parse(String(calls[0].init.body));
  assert.equal(request.model, "vendor/model");
  assert.equal(request.response_format.type, "json_schema");
  assert.deepEqual(result.parsed, { answer: "ok" });
  assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 4 });
});

test("compatible client retries once with json_object when json_schema is unsupported", async () => {
  const requests = [];
  const config = resolveOpenAICompatibleConfig({
    apiKey: "test-secret",
    baseUrl: "https://compatible.example/v1",
    model: "model-a",
    apiStyle: "chat-completions",
  });

  const result = await requestStructuredJson({
    config,
    name: "test_schema",
    schema,
    instructions: "Return JSON.",
    input: "hola",
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init.body));
      requests.push(body);
      if (requests.length === 1) {
        return {
          ok: false,
          status: 400,
          async json() {
            return { error: { message: "json_schema not supported" } };
          },
        };
      }
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{ message: { content: "```json\n{\"answer\":\"fallback\"}\n```" } }],
            usage: { prompt_tokens: 7, completion_tokens: 3 },
          };
        },
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].response_format.type, "json_schema");
  assert.equal(requests[1].response_format.type, "json_object");
  assert.deepEqual(result.parsed, { answer: "fallback" });
});
