import test from "node:test";
import assert from "node:assert/strict";
import {
  OpenAIContentProvider,
  extractOutputText,
} from "../services/analysis/OpenAIContentProvider.mjs";

const segments = Array.from({ length: 12 }, (_, index) => ({
  id: `segment-${index + 1}`,
  startTime: index * 6,
  endTime: index * 6 + 5.5,
  text:
    index % 3 === 0
      ? "¿Por qué nadie esperaba esto? De repente apareció un dato increíble."
      : index % 3 === 1
        ? "La explicación cambia por completo cuando comparas los dos resultados."
        : "Finalmente podemos entender la idea sin depender de contexto adicional.",
}));

test("extractOutputText reads Responses API message output", () => {
  const text = extractOutputText({
    output: [
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: '{"selections":[]}',
          },
        ],
      },
    ],
  });

  assert.equal(text, '{"selections":[]}');
});

test("OpenAI provider keeps model selections tied to real candidate IDs", async () => {
  let capturedUrl = "";
  let capturedRequest;

  const provider = new OpenAIContentProvider({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://example.invalid/v1/",
    fetchImpl: async (url, init) => {
      capturedUrl = String(url);
      capturedRequest = JSON.parse(String(init.body));

      const source = JSON.parse(capturedRequest.input);
      const first = source.candidates[0];

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
                      selections: [
                        {
                          candidateId: first.candidateId,
                          title: "Título generado",
                          hook: "Hook generado",
                          reason: "Este candidato tiene contexto y un inicio fuerte.",
                          relevanceScore: 88,
                        },
                        {
                          candidateId: "candidate-inventado",
                          title: "No debe entrar",
                          hook: "No debe entrar",
                          reason: "ID inexistente",
                          relevanceScore: 100,
                        },
                      ],
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

  const candidates = await provider.analyze({
    transcript: { segments },
    options: {
      minDuration: 15,
      maxDuration: 60,
      targetDuration: 30,
      maxCandidates: 4,
    },
  });

  assert.equal(capturedUrl, "https://example.invalid/v1/responses");
  assert.equal(capturedRequest.model, "test-model");
  assert.equal(capturedRequest.store, false);
  assert.equal(capturedRequest.text.format.type, "json_schema");
  assert.ok(candidates.length > 0 && candidates.length <= 4);
  assert.equal(candidates[0].title, "Título generado");
  assert.equal(candidates[0].aiAssessment.relevanceScore, 88);
  assert.ok(
    candidates.every((candidate) => candidate.id !== "candidate-inventado"),
  );
});
