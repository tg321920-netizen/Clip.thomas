import assert from "node:assert/strict";
import test from "node:test";
import {
  OpenAIContentProvider,
  extractOpenAIUsage,
} from "../services/analysis/OpenAIContentProvider.mjs";
import { OpenAIAutoEditProvider } from "../services/autoedit/OpenAIAutoEditProvider.mjs";

const projectId = "11111111-1111-4111-8111-111111111111";

const segments = Array.from({ length: 8 }, (_, index) => ({
  id: `segment-${index + 1}`,
  startTime: index * 6,
  endTime: index * 6 + 5.5,
  text: `Segmento real ${index + 1} con información suficiente para analizar.`,
}));

test("usage extraction returns zero when a response does not provide usage", () => {
  assert.deepEqual(extractOpenAIUsage({}), {
    inputTokens: 0,
    outputTokens: 0,
  });
  assert.deepEqual(
    extractOpenAIUsage({ usage: { input_tokens: 120, output_tokens: 30 } }),
    { inputTokens: 120, outputTokens: 30 },
  );
});

test("content provider records returned token counts against the real project", async () => {
  let recorded = null;
  const provider = new OpenAIContentProvider({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://example.invalid/v1",
    usageService: {
      async record(value) {
        recorded = value;
      },
    },
    fetchImpl: async (_url, init) => {
      const request = JSON.parse(String(init.body));
      const source = JSON.parse(request.input);
      return jsonResponse({
        usage: { input_tokens: 222, output_tokens: 44 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  selections: [
                    {
                      candidateId: source.candidates[0].candidateId,
                      title: "Título",
                      hook: "Hook",
                      reason: "Razón",
                      relevanceScore: 80,
                    },
                  ],
                }),
              },
            ],
          },
        ],
      });
    },
  });

  await provider.analyze({
    project: { id: projectId },
    transcript: { segments },
    options: {
      minDuration: 15,
      maxDuration: 60,
      targetDuration: 30,
      maxCandidates: 2,
    },
  });

  assert.deepEqual(recorded, {
    provider: "openai",
    model: "test-model",
    operation: "content-analysis",
    inputTokens: 222,
    outputTokens: 44,
    projectId,
  });
});

test("auto edit provider records returned token counts against the real project", async () => {
  let recorded = null;
  const provider = new OpenAIAutoEditProvider({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://example.invalid/v1",
    usageService: {
      async record(value) {
        recorded = value;
      },
    },
    fetchImpl: async () =>
      jsonResponse({
        usage: { input_tokens: 333, output_tokens: 55 },
        output: [
          {
            type: "message",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  candidateId: "candidate-0001",
                  startTime: 0,
                  endTime: 25,
                  title: "Título",
                  hook: "Hook",
                  description: "Descripción",
                  hashtags: ["#clip"],
                  onScreenText: "Texto",
                  recommendedPlatforms: ["YOUTUBE"],
                  subtitleStyle: "CLEAN",
                  framingMode: "FILL",
                  quality: "BALANCED",
                  reason: "Razón",
                }),
              },
            ],
          },
        ],
      }),
  });

  await provider.prepare({
    project: { id: projectId },
    candidates: [
      {
        id: "candidate-0001",
        startTime: 0,
        endTime: 30,
        duration: 30,
        viralScore: 75,
        title: "Original",
        hook: "Original",
        text: "Contenido",
        reasons: ["Hook"],
      },
    ],
    transcript: { segments: [] },
    options: {},
  });

  assert.deepEqual(recorded, {
    provider: "openai",
    model: "test-model",
    operation: "auto-edit",
    inputTokens: 333,
    outputTokens: 55,
    projectId,
  });
});

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    async json() {
      return body;
    },
  };
}
