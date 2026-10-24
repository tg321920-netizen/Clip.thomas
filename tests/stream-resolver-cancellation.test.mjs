import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureSegmentedStream } from '../services/ingest/UrlIngestService.mjs';

test('cancelling live URL resolution terminates the actual extractor child before FFmpeg starts', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clipforge-resolver-cancel-'));
  const executable = path.join(directory, 'extractor.mjs');
  const marker = path.join(directory, 'pid');
  const previous = process.env.YTDLP_PATH;
  let pid;
  try {
    // A controlled long-running extractor process, not a platform request.
    await writeFile(executable, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync(${JSON.stringify(marker)}, String(process.pid));\nsetInterval(() => {}, 1000);\n`, { mode: 0o700 });
    process.env.YTDLP_PATH = executable;
    const controller = new AbortController();
    const capture = captureSegmentedStream({ url: 'https://twitch.tv/authorized-fixture', uploadDir: directory, captureSeconds: 60, signal: controller.signal });
    // Attach rejection handling before cancelling to avoid an unhandled rejection.
    const cancelled = assert.rejects(capture, error => error.name === 'AbortError');
    for (let attempt = 0; attempt < 100 && !pid; attempt++) {
      try { pid = Number(await readFile(marker, 'utf8')); } catch { await delay(20); }
    }
    assert.ok(pid, 'Extractor child started');
    controller.abort();
    let deadline;
    try { await Promise.race([cancelled, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('Cancellation did not stop URL resolution')), 2000); })]); }
    finally { clearTimeout(deadline); }
    for (let attempt = 0; attempt < 50; attempt++) {
      try { process.kill(pid, 0); } catch { pid = null; break; }
      await delay(20);
    }
    assert.equal(pid, null, 'Cancelled extractor must no longer be alive');
  } finally {
    if (pid) { try { process.kill(pid, 'SIGKILL'); } catch { /* Already exited. */ } }
    if (previous === undefined) delete process.env.YTDLP_PATH; else process.env.YTDLP_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
