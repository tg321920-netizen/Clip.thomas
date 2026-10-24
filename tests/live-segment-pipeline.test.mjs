import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { captureSegmentedStream, queueCapturedSegment } from '../services/ingest/UrlIngestService.mjs';
import { JobStore } from '../services/JobStore.mjs';
import { runMedia, probeMediaFile } from '../services/media-processing/MediaValidationService.mjs';
import { hashFile } from '../services/ingest/ResumableUploadStore.mjs';

test('real closed segments enqueue once, resume measured duration and preserve completed media', {
  skip: process.env.CLIPFORGE_RUN_MEDIA_TESTS !== 'true',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-segments-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    const input = path.join(root, 'authorized.mp4'), capture = path.join(root, 'capture');
    await mkdir(capture);
    await runMedia('ffmpeg', ['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x64:rate=5','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','65','-c:v','libx264','-preset','ultrafast','-threads','2','-g','5','-c:a','aac','-movflags','+faststart',input]);
    const job = { id: randomUUID(), source: { clipDuration: 15 } };
    const onSegment = async (file, index) => queueCapturedSegment({ file, index, job });
    await captureSegmentedStream({ url: input, uploadDir: capture, captureSeconds: 30, segmentSeconds: 30, onSegment });
    const first = path.join(capture, '.stream-parts', 'part-000000.ts');
    const before = await hashFile(first);
    const output = await captureSegmentedStream({ url: input, uploadDir: capture, captureSeconds: 60, segmentSeconds: 30, onSegment });
    const actual = await probeMediaFile(output);
    assert.ok(Math.abs(actual.duration - 60) < 1.5, `Measured recovery duration: ${actual.duration}`);
    assert.equal(await hashFile(first), before, 'Completed segment is never overwritten');
    const store = new JobStore();
    const queued = await store.listMedia(100);
    assert.equal(queued.length, 2);
    assert.ok(queued.every(item => item.type === 'MEDIA_CLIPS' && item.status === 'QUEUED'));
    for (const item of queued) assert.ok((await stat(path.join(root,'uploads',item.payload.projectId,'source.mp4'))).size > 0);
    await captureSegmentedStream({ url: input, uploadDir: capture, captureSeconds: 60, segmentSeconds: 30, onSegment });
    assert.equal((await store.listMedia(100)).length, 2, 'Retry does not enqueue duplicates');
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
