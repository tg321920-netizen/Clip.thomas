// State-machine fixtures only. The renderer is explicitly replaced; these
// tests do not prove media quality or produce a real podcast/streamer clip.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { BestClipsService } from '../services/analysis/BestClipsService.mjs';
import { RenderService } from '../services/clip/RenderService.mjs';
import { replaceProjectFile, loadProjectFile, updateProjectFile } from '../lib/project-files.mjs';

async function fixture(t, { inputOverrides = {}, output = { width: 1080, height: 1920 } } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-best-resume-')), previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  const render = RenderService.prototype.renderClip;
  t.after(async () => {
    RenderService.prototype.renderClip = render;
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const sourceId = randomUUID(), outputId = randomUUID(), clipId = randomUUID(), transcriptId = randomUUID();
  const input = { projectId: sourceId, count: 1, minDuration: 25, maxDuration: 35, targetDuration: 30, subtitleMode: 'ORIGINAL_EN', ...inputOverrides };
  const provider = { name: 'EXPLICIT_FIXTURE', model: null, visionEnabled: false, analyze: async () => assert.fail('cached decision called the model again') };
  const candidate = { id: 'candidate-0001', startTime: 0, endTime: 30, duration: 30, title: 'Explicit checkpoint fixture', reason: 'State regression only', text: 'This explicit fixture tests checkpoint recovery without representing a real editorial decision.' };
  const original = { id: sourceId, source: { mediaKind: 'AUDIO', hasAudio: true, durationSeconds: 60, originalName: 'fixture.m4a' },
    transcript: { id: transcriptId, status: 'COMPLETED', language: 'en', segments: [{ startTime: 0, endTime: 30, text: candidate.text }] },
    liveObservation: { source: { channelId: 'FIXTURE', sourceId: 'fixture-original', sourceKind: 'FILE' } } };
  const track = { mode: 'ORIGINAL_EN', language: 'en', enabled: true, style: 'CLEAN', sourceTranscriptId: transcriptId, updatedAt: 'saved-correction',
    cues: [{ id: 'cue-1', startTime: 0, endTime: 10, text: 'This text was corrected before interruption.' }] };
  const checkpointKey = createHash('sha256').update(JSON.stringify({ input, width: output.width, height: output.height, transcript: original.transcript,
    chatActivityWindows: [], continuityBreaks: [], provider: provider.name, model: null, vision: false })).digest('hex');
  const saved = { id: clipId, projectId: outputId, candidateId: candidate.id, startTime: 0, endTime: 30, duration: 30, status: 'DRAFT',
    title: candidate.title, reason: candidate.reason, edit: { subtitleMode: 'ORIGINAL_EN', subtitlesEnabled: true, subtitleStyle: 'CLEAN', framingMode: 'FIT', quality: 'EFFICIENT' },
    subtitles: track, subtitleHistory: [{ versionId: 'fixture-history', track }], editorialReview: { status: 'PENDING' }, render: null };
  await replaceProjectFile(sourceId, original);
  await replaceProjectFile(outputId, { ...original, id: outputId, clips: [saved], analysis: { candidates: [candidate] },
    clipsOrigin: { projectId: sourceId, checkpointKey, requestedCount: 1, selectedCount: 1, deliveryComplete: false } });
  const record = clip => ({ mediaKind: 'AUDIO', relativePath: `clips/${outputId}/${clip.id}/render.mp4`, sourceUrl: `/api/projects/${outputId}/clips/${clip.id}/source`,
    validation: { valid: true, fixtureOnly: true } });
  return { root, original, input, provider, outputId, clipId, track, record };
}

test('resuming a saved automatic cut keeps its identity, corrected subtitles and history', async t => {
  const f = await fixture(t);
  RenderService.prototype.renderClip = async ({ clip }) => f.record(clip);
  const result = await new BestClipsService({ provider: f.provider }).render(f.outputId, f.input);
  const saved = (await loadProjectFile(f.outputId)).clips;
  assert.equal(saved.length, 1); assert.equal(result.clips[0].clipId, f.clipId);
  assert.equal(saved[0].subtitles.cues[0].text, f.track.cues[0].text);
  assert.equal(saved[0].subtitleHistory.length, 1); assert.equal(saved[0].edit.framingMode, 'FIT');
});

test('the automatic renderer persists a busy state before encoding and preserves a concurrent editorial review', async t => {
  const f = await fixture(t);
  RenderService.prototype.renderClip = async ({ clip }) => {
    assert.equal((await loadProjectFile(f.outputId)).clips[0].status, 'PROCESSING');
    await updateProjectFile(f.outputId, saved => { saved.clips[0].editorialReview = { status: 'REJECTED', reason: 'Explicit QA review fixture' }; });
    return f.record(clip);
  };
  const result = await new BestClipsService({ provider: f.provider }).render(f.outputId, f.input);
  assert.equal(result.clips[0].editorialReview.status, 'REJECTED');
  assert.equal((await loadProjectFile(f.outputId)).clips[0].editorialReview.status, 'REJECTED');
});

test('an interrupted automatic render retains the cut and subtitles in an editable failed state', async t => {
  const f = await fixture(t);
  RenderService.prototype.renderClip = async () => { throw new Error('Explicit fixture encoder interruption'); };
  await assert.rejects(new BestClipsService({ provider: f.provider }).render(f.outputId, f.input), /encoder interruption/);
  const saved = (await loadProjectFile(f.outputId)).clips;
  assert.equal(saved.length, 1); assert.equal(saved[0].id, f.clipId); assert.equal(saved[0].status, 'FAILED');
  assert.equal(saved[0].subtitles.cues[0].text, f.track.cues[0].text);
});

test('an incompatible automatic checkpoint is preserved instead of mixing a new request with older cuts', async t => {
  const f = await fixture(t);
  await assert.rejects(new BestClipsService({ provider: f.provider }).render(f.outputId, { ...f.input, targetDuration: 31 }), { code: 'WAITING_RESOURCE' });
  const saved = (await loadProjectFile(f.outputId)).clips;
  assert.equal(saved.length, 1); assert.equal(saved[0].id, f.clipId);
  assert.equal(saved[0].subtitles.cues[0].text, f.track.cues[0].text);
});

test('automatic format and resolution reach the existing renderer without a silent vertical override', async t => {
  const f = await fixture(t, { inputOverrides: { format: '16:9', resolution: '720p', quality: 'EFFICIENT' }, output: { width: 1280, height: 720 } });
  RenderService.prototype.renderClip = async function ({ clip }) {
    assert.equal(this.width, 1280); assert.equal(this.height, 720);
    return f.record(clip);
  };
  const result = await new BestClipsService({ provider: f.provider }).render(f.outputId, f.input);
  assert.equal(result.clips[0].clipId, f.clipId);
});
