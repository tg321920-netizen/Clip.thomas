import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssDocument,
  buildSubtitleTrack,
  sanitizeSubtitleCues,
  buildSrtDocument,
  generateSubtitleTrack,
  updateSubtitleTrack,
} from "../services/subtitles/SubtitleService.mjs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProjectFile, replaceProjectFile, updateProjectFile } from "../lib/project-files.mjs";

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

test("captions break at a real pause and corrected karaoke never keeps the old words", () => {
  const track = buildSubtitleTrack({ clip, transcript: { segments: [{ startTime: 10, endTime: 18, text: 'Hello again', words: [
    { startTime: 10, endTime: 11, text: 'Hello' }, { startTime: 15, endTime: 16, text: 'again' },
  ] }] } });
  assert.equal(track.cues.length, 2);
  assert.equal(track.cues[0].endTime, 1);
  assert.equal(track.cues[1].startTime, 5);
  const cues = sanitizeSubtitleCues([{ startTime: 0, endTime: 1, text: 'Hola', words: [{ startTime: 0, endTime: 1, text: 'Hello' }] }], 2);
  assert.equal(cues[0].words, undefined);
  assert.match(buildAssDocument({ style: 'KARAOKE', cues }), /Hola/);
  assert.doesNotMatch(buildAssDocument({ style: 'KARAOKE', cues }), /Hello/);
});

test("SRT uses local millisecond times and refuses overlapping captions", () => {
  assert.equal(buildSrtDocument({ cues: [{ startTime: 0.125, endTime: 2.5, text: '¿Por qué no?' }] }), '1\n00:00:00,125 --> 00:00:02,500\n¿Por qué no?\n');
  assert.throws(() => sanitizeSubtitleCues([{ startTime: 0, endTime: 2, text: 'Uno' }, { startTime: 1, endTime: 3, text: 'Dos' }], 4), /solapan/);
});

test("ASR non-speech markers are not translated or burned as spoken words", () => {
  const transcript = { segments: [{ startTime: 10, endTime: 12, text: '[APPLAUSE]' }, { startTime: 14, endTime: 20, text: 'We choose the moon. [BLANK_AUDIO]' }] };
  const before = JSON.stringify(transcript);
  const track = buildSubtitleTrack({ clip, transcript });
  assert.equal(track.cues.length, 1);assert.equal(track.cues[0].text, 'We choose the moon.');
  assert.equal(track.cues[0].startTime, 4);assert.equal(JSON.stringify(transcript), before);
});

test("subtitle edits serialize with project updates and reject an active render", async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-subtitle-atomic-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(async () => { if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous; await rm(root, { recursive: true, force: true }); });
  const id = '8e56073f-ae3a-4c2c-a73d-b11085dbd1b6';
  const clipId = '4f04cb73-be42-4dd1-a799-e5cd222c32b8';
  await replaceProjectFile(id, { id, clips: [{ ...clip, id: clipId, status: 'READY', edit: {} }], transcript: { id: 'asr', status: 'COMPLETED', segments: [{ startTime: 10, endTime: 12, text: 'Prueba real del almacenamiento.' }] } });
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const locked = new Promise(resolve => { entered = resolve; });
  const other = updateProjectFile(id, async project => { entered(); await gate; project.annotation = 'Preserve this newer update'; });
  await locked;
  const generation = generateSubtitleTrack(id, clipId);
  await new Promise(resolve => setTimeout(resolve, 50));
  release();
  await Promise.all([other, generation]);
  const project = await loadProjectFile(id);
  assert.equal(project.annotation, 'Preserve this newer update');
  assert.equal(project.clips[0].subtitles.cues.length, 1);
  assert.equal(project.clips[0].editRevision, 1);
  const unchanged = await updateSubtitleTrack(id, clipId, { cues: project.clips[0].subtitles.cues });
  assert.equal(unchanged.updatedAt, project.clips[0].subtitles.updatedAt);
  assert.equal((await loadProjectFile(id)).clips[0].editRevision, 1);
  await updateProjectFile(id, p => { p.clips[0].status = 'RENDERING'; });
  await assert.rejects(updateSubtitleTrack(id, clipId, { enabled: false }), { code: 'SUBTITLE_BUSY' });
  assert.equal((await loadProjectFile(id)).clips[0].status, 'RENDERING');
});
