import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { IngestJobStore, normalizeLiveClipSettings } from '../services/ingest/IngestJobStore.mjs';
import { queueCapturedBatch } from '../services/ingest/UrlIngestService.mjs';
import { JobStore } from '../services/JobStore.mjs';

test('five clips means one batch of five for the whole capture, without duplicate retry jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-five-live-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    const ingest = await new IngestJobStore().create({ url: 'https://example.invalid/authorized', mode: 'STREAM', autoClip: true, clipMode: 'CAPTURE', clipCount: 5, clipDuration: 30 });
    assert.equal(ingest.source.clipCount, 5);
    assert.equal(ingest.source.clipMode, 'CAPTURE');
    const projectId = randomUUID();
    const first = await queueCapturedBatch({ projectId, job: ingest });
    const retry = await queueCapturedBatch({ projectId, job: ingest });
    assert.equal(first.id, retry.id);
    assert.equal(first.payload.count, 5);
    assert.equal(first.payload.projectId, projectId);
    assert.equal(first.type, 'MEDIA_CLIPS');
    assert.equal((await new JobStore().listMedia()).length, 1);
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test('live count is bounded and old incremental captures keep their behavior', () => {
  assert.equal(normalizeLiveClipSettings({}).clipMode, 'SEGMENTS');
  assert.equal(normalizeLiveClipSettings({ clipCount: 5 }).clipMode, 'CAPTURE');
  for (const value of [0, 11, 2.5, 'invalid']) assert.throws(() => normalizeLiveClipSettings({ clipCount: value }), /cantidad/);
});
