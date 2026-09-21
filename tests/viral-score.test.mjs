import test from "node:test";
import assert from "node:assert/strict";
import { scoreCandidate } from "../services/analysis/ViralScoreService.mjs";

test("ViralScore stays in range and does not invent audio energy", () => {
  const result = scoreCandidate({
    duration: 28,
    text: "¿Sabías por qué este error cambió todo? De repente encontramos la causa y el resultado fue increíble.",
  });

  assert.ok(result.viralScore >= 0 && result.viralScore <= 100);
  assert.equal(result.components.audioEnergy, null);
  assert.equal(result.availableWeight, 85);
  assert.match(result.disclaimer, /no garantiza viralidad/i);
  assert.ok(result.reasons.some((reason) => /energía de audio/i.test(reason)));
});

test("strong hooks score above a plain fragment with the same duration", () => {
  const strong = scoreCandidate({
    duration: 30,
    text: "¿Por qué nadie te cuenta esto? De repente todo cambia y el resultado es increíble.",
  });

  const plain = scoreCandidate({
    duration: 30,
    text: "Y entonces seguimos hablando de la misma cosa durante un rato sin llegar a una conclusión clara",
  });

  assert.ok(strong.viralScore > plain.viralScore);
});
