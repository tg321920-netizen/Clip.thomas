import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runMedia } from '../services/media-processing/MediaValidationService.mjs';
import { measureAudioEnergy, measureSceneChanges } from '../services/analysis/AudioEnergyService.mjs';

test('highlight evidence detects a real scene cut and measured loudness change', {
  skip: process.env.CLIPFORGE_RUN_MEDIA_TESTS !== 'true',
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-measured-signals-'));
  try {
    const file = path.join(root, 'authorized-signals.mp4');
    await runMedia('ffmpeg', [
      '-v','error','-y',
      '-f','lavfi','-i','color=black:size=64x64:rate=2:d=5',
      '-f','lavfi','-i','sine=frequency=440:duration=5',
      '-f','lavfi','-i','color=white:size=64x64:rate=2:d=5',
      '-f','lavfi','-i','sine=frequency=440:duration=5',
      '-filter_complex','[0:v][2:v]concat=n=2:v=1:a=0[v];[1:a]volume=0.01[a0];[3:a]volume=0.8[a1];[a0][a1]concat=n=2:v=0:a=1[a]',
      '-map','[v]','-map','[a]','-c:v','libx264','-threads','2','-pix_fmt','yuv420p','-c:a','aac',file,
    ]);
    const energy = await measureAudioEnergy(file);
    assert.ok(energy.length >= 2);
    assert.ok(energy[1].db > energy[0].db + 20, 'RMS must reflect the actual change, not an invented score');
    const cuts = await measureSceneChanges(file);
    assert.ok(cuts.some(time => Math.abs(time - 5) < 1), `Expected a real cut at 5 s, got ${cuts}`);
  } finally { await rm(root, { recursive: true, force: true }); }
});
