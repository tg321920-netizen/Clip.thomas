import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { LiveObservationStore, sameLiveSource, alignChatToCapture } from '../services/live/LiveObservationStore.mjs';
const source = { channel: 'westcol', channelId: '669746', chatroomId: '669512', sourceId: '01a17413-f760-7067-aa90-2e6d458a1aa6', sourceKind: 'LIVE', startedAt: '2026-10-25T17:20:28Z' };
const id = '11111111-1111-4111-8111-111111111111';
const bin = { utc: '2026-10-25T17:30:00Z', messages: 50, uniqueSenders: 40, distinctTexts: 10, dominantTextCount: 35, dominantTextSenders: 30, complete: true, rawText: 'not stored', senderId: 'not stored' };
test('observations retain numeric evidence, restore the same VOD and ignore damaged unrelated records', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-observations-'));
  try {
    const store = new LiveObservationStore({ root, env: {} });
    const saved = await store.save({ id, source, bins: [bin], captureStatus: 'FAILED' });
    assert.equal(saved.cloudSaved, false); assert.doesNotMatch(JSON.stringify(saved.record), /not stored/u);
    await writeFile(path.join(root, 'live-observations', '22222222-2222-4222-8222-222222222222.json'), '{damaged');
    const found = await store.loadForSource({ ...source, sourceKind: 'VOD' });
    assert.equal(found.bins.length, 1); assert.equal(found.recordIds[0], id);
    assert.equal((await store.loadForSource({ ...source, sourceId: 'other-stream', startedAt: '2026-10-24T17:20:28Z' })).bins.length, 0);
    assert.ok(sameLiveSource({ ...source, sourceId: 'numeric-live-id', startedAt: '2026-10-25T17:20:31Z' }, source));
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('optional R2 observations are private counters and failed cloud writes preserve local data', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-observation-cloud-')); let key, value;
  const cloud = { putJson: async (k, v) => { key = k; value = v; } };
  try {
    const store = new LiveObservationStore({ root, env: {}, cloud });
    assert.equal((await store.save({ id, source, bins: [bin] }, { archive: true })).cloudSaved, true);
    assert.ok(key.startsWith('clipforge-managed/v1/observations/669746/'));
    assert.doesNotMatch(JSON.stringify(value), /rawText|senderId/u);
    cloud.putJson = async () => { throw new Error('do not reveal transport'); };
    const failed = await store.save({ id, source, bins: [bin] }, { archive: true });
    assert.ok(failed.cloudError); assert.equal((await store.loadForSource(source, { includeCloud: false })).bins.length, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('chat alignment uses actual capture ranges and excludes missing time between resumed ranges', () => {
  const start = Date.parse('2026-10-25T17:00:00Z');
  const bins = Array.from({ length: 8 }, (_, i) => ({ utc: new Date(start + i * 10000).toISOString(), messages: 20, uniqueSenders: 20, distinctTexts: 20 }));
  const windows = alignChatToCapture(bins, { sourceRanges: [{ offsetSeconds: 0, sourceStartUtc: new Date(start).toISOString() },
    { offsetSeconds: 10, sourceStartUtc: new Date(start + 60000).toISOString() }] }, 20);
  assert.deepEqual(windows.map(w => w.utc), ['2026-10-25T17:00:00.000Z', '2026-10-25T17:01:00.000Z']);
  assert.deepEqual(windows.map(w => w.start), [0, 10]);
  assert.deepEqual(alignChatToCapture(bins, {}, 20), []);
});
