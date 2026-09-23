import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSpeechWindows,
  buildSpeechZoomFilter,
  normalizeAutoReframeOptions,
} from "../services/reframe/AutoReframeService.mjs";

const clip = {
  startTime: 10,
  endTime: 30,
  duration: 20,
};

const transcript = {
  id: "transcript-1",
  segments: [
    { startTime: 9, endTime: 12, text: "Antes y dentro del clip." },
    { startTime: 12.2, endTime: 15, text: "Seguimos hablando." },
    { startTime: 20, endTime: 22, text: "Otra frase." },
  ],
};

test("speech windows are rebased to clip-local time and nearby speech is merged", () => {
  const windows = buildSpeechWindows(transcript, clip, {
    paddingBeforeMs: 0,
    paddingAfterMs: 0,
    mergeGapMs: 300,
  });

  assert.equal(windows.length, 2);
  assert.equal(windows[0].startTime, 0);
  assert.equal(windows[0].endTime, 5);
  assert.equal(windows[1].startTime, 10);
  assert.equal(windows[1].endTime, 12);
  assert.equal(windows[0].focusX, 0.5);
  assert.equal(windows[0].focusY, 0.44);
});

test("auto reframe options clamp unsafe zoom and timing values", () => {
  const config = normalizeAutoReframeOptions({
    zoom: 9,
    attackMs: 10,
    releaseMs: 9999,
  });

  assert.equal(config.zoom, 1.35);
  assert.equal(config.attackMs, 80);
  assert.equal(config.releaseMs, 1600);
});

test("speech zoom filter uses real speech windows and smooth previous-frame zoom", () => {
  const filter = buildSpeechZoomFilter(
    {
      enabled: true,
      mode: "SPEECH_ZOOM",
      zoom: 1.18,
      attackMs: 180,
      releaseMs: 260,
      windows: [
        { startTime: 1, endTime: 3, focusX: 0.5, focusY: 0.44 },
        { startTime: 5, endTime: 6, focusX: 0.5, focusY: 0.44 },
      ],
    },
    30,
  );

  assert.match(filter, /zoompan=/);
  assert.match(filter, /between\(on,30,90\)/);
  assert.match(filter, /between\(on,150,180\)/);
  assert.match(filter, /pzoom/);
  assert.match(filter, /1\.18/);
  assert.match(filter, /s=1080x1920/);
  assert.match(filter, /fps=30/);
});

test("disabled auto reframe adds no FFmpeg filter", () => {
  const filter = buildSpeechZoomFilter(
    {
      enabled: false,
      mode: "SPEECH_ZOOM",
      windows: [{ startTime: 0, endTime: 2 }],
    },
    30,
  );

  assert.equal(filter, "");
});
