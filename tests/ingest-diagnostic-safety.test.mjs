import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { sanitizeIngestDiagnostic, captureSegmentedStream } from '../services/ingest/UrlIngestService.mjs';

test('ingest errors redact signed playback URLs and authorization before truncating', () => {
  const privateValue = 'private-playback-value-'.repeat(500);
  const message = `Server returned 400 Bad Request\nOpening https://media.example.invalid/private.m3u8?token=${privateValue}\nAuthorization: Bearer confidential-value\n`;
  const safe = sanitizeIngestDiagnostic(message);
  assert.match(safe, /400 Bad Request/);
  assert.match(safe, /MEDIA_URL/);
  assert.doesNotMatch(safe, /private-playback|media\.example|confidential-value|Bearer/i);
  assert.ok(safe.length < 200);
  assert.doesNotMatch(sanitizeIngestDiagnostic(`truncated-prefix-${'a'.repeat(5000)}`), /a{120}/);
});

test('a failing capture subprocess cannot leak the tail of a very long playback URL', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-capture-error-'));
  const original = process.env.FFMPEG_PATH;
  try {
    const executable = path.join(root, 'failed-capture');
    const secret = 'temporary-playback-value-'.repeat(500);
    const stderr = `Server returned 400 Bad Request\nError opening input file https://media.example.invalid/live.m3u8?token=${secret}\n`;
    await writeFile(executable, `#!/usr/bin/env node\nprocess.stderr.write(${JSON.stringify(stderr)}, () => process.exit(1));\n`, { mode: 0o700 });
    process.env.FFMPEG_PATH = executable;
    await assert.rejects(() => captureSegmentedStream({ url: '/authorized-source.mp4', uploadDir: path.join(root, 'capture'), captureSeconds: 30 }), error => {
      assert.match(error.message, /400 Bad Request/);
      assert.doesNotMatch(error.message, /temporary-playback-value|media\.example/);
      assert.ok(error.message.length < 200);
      return true;
    });
  } finally {
    if (original === undefined) delete process.env.FFMPEG_PATH; else process.env.FFMPEG_PATH = original;
    await rm(root, { recursive: true, force: true });
  }
});
