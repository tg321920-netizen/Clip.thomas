import test from "node:test";
import assert from "node:assert/strict";
import { TranscriptCandidateProvider } from "../services/analysis/TranscriptCandidateProvider.mjs";
import { sentenceSegments } from "../services/analysis/AudioEnergyService.mjs";

const options = { minDuration: 15, maxDuration: 30, targetDuration: 20, maxCandidates: 10, requireCompleteSentences: true };

test("clip mode rejects a trailing unfinished sentence instead of padding the requested count", async () => {
  const provider = new TranscriptCandidateProvider();
  const candidates = await provider.analyze({ options, transcript: { segments: [
    { startTime: 0, endTime: 20, text: "La primera decisión reduce los costos del negocio y permite atender mejor a cada cliente." },
    { startTime: 22, endTime: 42, text: "La segunda propuesta requiere explicar cómo funciona y por qué" },
  ] } });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].startTime, 0);
  assert.equal(candidates[0].endTime, 20);
});

test("clip mode joins Whisper fragments and cannot start midway through a sentence", async () => {
  const transcript = { segments: [
    { startTime: 0, endTime: 12, text: "Para organizar una entrevista conviene preparar" },
    { startTime: 12, endTime: 25, text: "preguntas abiertas y escuchar la respuesta completa." },
  ] };
  const candidates = await new TranscriptCandidateProvider().analyze({ transcript, options });
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].startTime, 0);
  assert.equal(candidates[0].endTime, 25);
  assert.match(candidates[0].text, /^Para organizar/);
  assert.equal(sentenceSegments(transcript.segments).length, 1);
});

test("strict clip mode returns no result for incomplete, ellipsis or out-of-range speech", async () => {
  for (const [endTime, text] of [[20, "Una explicación todavía incompleta"], [20, "Necesitamos esperar..."], [20, "Necesitamos esperar…"], [40, "Una frase completa pero demasiado larga."]]) {
    const candidates = await new TranscriptCandidateProvider().analyze({ options, transcript: { segments: [{ startTime: 0, endTime, text }] } });
    assert.deepEqual(candidates, []);
  }
});

test("question and quoted sentence endings remain eligible at actual transcript times", async () => {
  const transcript = { segments: [{ startTime: 5, endTime: 25, text: "¿Cómo aprendimos a reducir gastos sin perder calidad en los resultados?" },
    { startTime: 30, endTime: 50, text: "El profesor explicó: «Una clase debe ayudar a resolver un problema concreto.»" }] };
  const candidates = await new TranscriptCandidateProvider().analyze({ transcript, options });
  assert.equal(candidates.length, 2);
  assert.ok(candidates.every(c => [5, 30].includes(c.startTime) && c.duration === 20));
});
