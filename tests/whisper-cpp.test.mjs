import assert from "node:assert/strict";
import test from "node:test";
import { convertWhisperCppPayload } from "../services/transcription/WhisperCppProvider.mjs";
import { normalizeWhisperResult } from "../lib/transcript-normalizer.mjs";

test("whisper.cpp payload converts to ClipForge transcript segments and words", () => {
  const converted = convertWhisperCppPayload({
    result: { language: "es" },
    transcription: [
      {
        offsets: { from: 0, to: 1500 },
        text: " Hola mundo.",
        tokens: [
          { text: " Hola", offsets: { from: 0, to: 700 }, p: 0.95 },
          { text: " mundo", offsets: { from: 700, to: 1400 }, p: 0.9 },
        ],
      },
    ],
  });

  const normalized = normalizeWhisperResult(converted);
  assert.equal(normalized.language, "es");
  assert.equal(normalized.text, "Hola mundo.");
  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0].startTime, 0);
  assert.equal(normalized.segments[0].endTime, 1.5);
  assert.equal(normalized.segments[0].text, "Hola mundo.");
  assert.deepEqual(normalized.segments[0].words, [
    { startTime: 0, endTime: 0.7, text: "Hola", probability: 0.95 },
    { startTime: 0.7, endTime: 1.4, text: "mundo", probability: 0.9 },
  ]);
});

test("whisper.cpp conversion ignores invalid segments and special tokens", () => {
  const converted = convertWhisperCppPayload({
    params: { language: "auto" },
    transcription: [
      { offsets: { from: 900, to: 100 }, text: "invalid" },
      { offsets: { from: 0, to: 1000 }, text: " válido", tokens: [
        { text: "<|0.00|>", offsets: { from: 0, to: 1 }, p: 1 },
        { text: " válido", offsets: { from: 50, to: 950 }, p: 0.8 },
      ] },
      { offsets: { from: 1000, to: 1800 }, text: "" },
    ],
  });

  const normalized = normalizeWhisperResult(converted);
  assert.equal(normalized.language, null);
  assert.equal(normalized.segments.length, 1);
  assert.equal(normalized.segments[0].text, "válido");
  assert.equal(normalized.segments[0].words.length, 1);
  assert.equal(normalized.segments[0].words[0].text, "válido");
});
