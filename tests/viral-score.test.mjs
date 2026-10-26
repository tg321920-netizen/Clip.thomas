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
  assert.equal(result.availableWeight, 95);
  assert.match(result.disclaimer, /no usa ni inventa estadísticas reales de engagement/i);
  assert.ok(result.reasons.some((reason) => /energía de audio/i.test(reason)));
  assert.ok(Number.isFinite(result.components.clarity));
  assert.ok(Number.isFinite(result.components.relevance));
  assert.ok(Number.isFinite(result.components.shortFormPotential));
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

test("a question later in a clip cannot masquerade as its opening hook", () => {
  const opening='We organized the project and completed the work with the whole team.';
  const later=scoreCandidate({duration:30,text:opening+' Why was the result so surprising?'});
  const plain=scoreCandidate({duration:30,text:opening+' The result was useful for everyone.'});
  assert.equal(later.components.hook,plain.components.hook);
  assert.ok(!later.reasons.includes('El inicio contiene señales de hook fuertes.'));
  const dependent=scoreCandidate({duration:30,text:'Its results require understanding the earlier conversation before the explanation makes sense.'});
  assert.ok(dependent.components.standaloneComprehensibility<plain.components.standaloneComprehensibility);
});

test("redundancy penalty is explicit and reduces the final score without changing base score", () => {
  const candidate = {
    duration: 30,
    text: "¿Cómo funciona esto? La explicación completa se entiende sola y termina con una conclusión clara.",
  };
  const original = scoreCandidate(candidate);
  const redundant = scoreCandidate(candidate, { redundancyPenalty: 18 });

  assert.equal(redundant.baseScore, original.baseScore);
  assert.equal(redundant.redundancyPenalty, 18);
  assert.equal(redundant.viralScore, Math.max(0, original.viralScore - 18));
  assert.ok(redundant.reasons.some((reason) => /similitud/i.test(reason)));
});
