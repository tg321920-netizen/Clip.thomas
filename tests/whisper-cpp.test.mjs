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

test("incomplete token timings preserve the full segment text for subtitles", () => {
  const converted = convertWhisperCppPayload({ transcription: [{
    offsets: { from: 0, to: 5000 }, text: " Esta historia conserva todas sus palabras.",
    tokens: [
      { text: " Esta", offsets: { from: 0, to: 500 } },
      { text: " historia", offsets: { from: -1, to: -1 } },
      { text: " conserva", offsets: { from: -1, to: -1 } },
      { text: " todas", offsets: { from: -1, to: -1 } },
      { text: " sus", offsets: { from: -1, to: -1 } },
      { text: " palabras.", offsets: { from: 4500, to: 5000 } },
    ],
  }] });
  assert.equal(converted.segments[0].text, "Esta historia conserva todas sus palabras.");
  assert.equal(converted.segments[0].words, undefined);
});

test("complete subword token timings are merged without dropping accents or punctuation", () => {
  const converted = convertWhisperCppPayload({ transcription: [{
    offsets: { from: 0, to: 2000 }, text: " cooperación natural.",
    tokens: [
      { text: " coop", offsets: { from: 0, to: 400 } },
      { text: "eración", offsets: { from: 400, to: 900 } },
      { text: " natural", offsets: { from: 900, to: 1700 } },
      { text: ".", offsets: { from: 1700, to: 1800 } },
    ],
  }] });
  assert.deepEqual(converted.segments[0].words.map(word=>word.word),["cooperación","natural."]);
});

test("segment mode never exposes token offsets as word alignment", () => {
  const converted = convertWhisperCppPayload({ transcription: [{
    offsets: { from: 0, to: 8000 }, text: "Conservamos una frase completa para subtítulos normales.",
    tokens: [{ text: " Conservamos una frase completa para subtítulos normales.", offsets: { from: 0, to: 8000 } }],
  }] }, { includeWords: false });
  assert.equal(converted.segments[0].words, undefined);
  assert.equal(converted.segments[0].text, "Conservamos una frase completa para subtítulos normales.");
});
