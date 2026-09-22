import test from "node:test";
import assert from "node:assert/strict";
import { OpenAIAutoEditProvider } from "../services/autoedit/OpenAIAutoEditProvider.mjs";

test("OpenAI Auto Edit uses structured Responses output", async () => {
  let requestBody;

  const provider = new OpenAIAutoEditProvider({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://example.invalid/v1/",
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init.body));

      return {
        ok: true,
        status: 200,
        async json() {
          return {
            output: [
              {
                type: "message",
                content: [
                  {
                    type: "output_text",
                    text: JSON.stringify({
                      candidateId: "candidate-0001",
                      startTime: 1,
                      endTime: 25,
                      title: "Título mejorado",
                      hook: "Hook mejorado",
                      description: "Descripción breve",
                      hashtags: ["#tema", "#clip"],
                      onScreenText: "Texto en pantalla",
                      recommendedPlatforms: ["TIKTOK", "YOUTUBE"],
                      subtitleStyle: "VIRAL",
                      framingMode: "FILL",
                      quality: "BALANCED",
                      reason: "El clip tiene un hook inmediato.",
                    }),
                  },
                ],
              },
            ],
          };
        },
      };
    },
  });

  const result = await provider.prepare({
    candidates: [
      {
        id: "candidate-0001",
        startTime: 0,
        endTime: 30,
        duration: 30,
        viralScore: 80,
        title: "Original",
        hook: "Original hook",
        text: "Contenido del candidato.",
        reasons: ["Hook"],
      },
    ],
    transcript: { segments: [] },
    options: {},
  });

  assert.equal(requestBody.model, "test-model");
  assert.equal(requestBody.store, false);
  assert.equal(requestBody.text.format.type, "json_schema");
  assert.equal(result.candidateId, "candidate-0001");
  assert.equal(result.title, "Título mejorado");
  assert.equal(result.subtitleStyle, "VIRAL");
});
