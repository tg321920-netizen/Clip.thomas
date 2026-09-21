import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhisperResult } from "../lib/transcript-normalizer.mjs";

test("normalizes Whisper segments and word timestamps", () => {
  const result = normalizeWhisperResult({
    language: "es",
    text: " Hola mundo. Segunda frase. ",
    segments: [
      {
        start: 0.1,
        end: 1.7,
        text: " Hola mundo. ",
        words: [
          { start: 0.1, end: 0.6, word: " Hola", probability: 0.91 },
          { start: 0.6, end: 1.2, word: " mundo", probability: 0.88 },
        ],
      },
      { start: 1.8, end: 3.2, text: " Segunda frase. " },
    ],
  });

  assert.equal(result.language, "es");
  assert.equal(result.text, "Hola mundo. Segunda frase.");
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments[0], {
    id: "segment-000001",
    startTime: 0.1,
    endTime: 1.7,
    text: "Hola mundo.",
    words: [
      { startTime: 0.1, endTime: 0.6, text: "Hola", probability: 0.91 },
      { startTime: 0.6, endTime: 1.2, text: "mundo", probability: 0.88 },
    ],
  });
  assert.equal(result.durationSeconds, 3.2);
});

test("drops invalid or empty transcript segments", () => {
  const result = normalizeWhisperResult({
    segments: [
      { start: 0, end: 0, text: "bad" },
      { start: 2, end: 1, text: "bad" },
      { start: 1, end: 2, text: "   " },
      { start: 2, end: 3, text: " valid " },
    ],
  });

  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].text, "valid");
  assert.equal(result.text, "valid");
});
