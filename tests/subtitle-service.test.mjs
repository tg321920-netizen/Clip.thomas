import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssDocument,
  buildSubtitleTrack,
  sanitizeSubtitleCues,
} from "../services/subtitles/SubtitleService.mjs";

const clip = {
  startTime: 10,
  endTime: 22,
  duration: 12,
};

test("subtitle track is clipped and rebased to clip-local time", () => {
  const track = buildSubtitleTrack({
    clip,
    style: "VIRAL",
    transcript: {
      id: "transcript-1",
      segments: [
        {
          startTime: 8,
          endTime: 14,
          text: "Antes del clip y luego una frase importante.",
          words: [
            { startTime: 10.2, endTime: 10.7, text: "Una" },
            { startTime: 10.7, endTime: 11.2, text: "frase" },
            { startTime: 11.2, endTime: 11.9, text: "importante." },
          ],
        },
        {
          startTime: 15,
          endTime: 20,
          text: "Segunda frase dentro del clip con contexto suficiente.",
        },
      ],
    },
  });

  assert.equal(track.style, "VIRAL");
  assert.ok(track.cues.length >= 2);
  assert.equal(track.cues[0].startTime, 0.2);
  assert.equal(track.cues[0].text, "Una frase importante.");
  assert.ok(track.cues.every((cue) => cue.startTime >= 0));
  assert.ok(track.cues.every((cue) => cue.endTime <= clip.duration));
});

test("editable cues reject timing outside the clip", () => {
  assert.throws(
    () =>
      sanitizeSubtitleCues(
        [
          {
            id: "cue-1",
            startTime: 0,
            endTime: 13,
            text: "Fuera del clip",
          },
        ],
        12,
      ),
    /invalid timing/i,
  );
});

test("ASS output includes selected style and karaoke timing tags", () => {
  const document = buildAssDocument({
    style: "KARAOKE",
    cues: [
      {
        id: "cue-0001",
        startTime: 0.5,
        endTime: 2,
        text: "Hola mundo",
        words: [
          { startTime: 0.5, endTime: 1, text: "Hola" },
          { startTime: 1, endTime: 1.7, text: "mundo" },
        ],
      },
    ],
  });

  assert.match(document, /PlayResX: 1080/);
  assert.match(document, /Arial,66/);
  assert.match(document, /\\k50/);
  assert.match(document, /\\k70/);
  assert.match(document, /Dialogue: 0,0:00:00\.50,0:00:02\.00/);
});
