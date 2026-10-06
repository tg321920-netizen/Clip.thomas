import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { queueSmartPublishJob } from '../services/publishing/SmartPublishJobService.mjs';

test('repeated one-shot requests preserve published, active and indeterminate jobs', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-one-shot-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  try {
    const directory = path.join(root, 'smart-publish');
    await mkdir(directory, { recursive: true });
    const filename = path.join(directory, 'current.json');
    for (const status of ['QUEUED', 'RUNNING', 'YOUTUBE_PROCESSING', 'PUBLISHED', 'FAILED']) {
      const existing = { id: 'existing-job', channelId: 'test-channel', status, stage: status, publicationId: status === 'FAILED' || status === 'PUBLISHED' ? 'existing-publication' : null, externalPostUrl: status === 'PUBLISHED' ? 'https://www.youtube.com/watch?v=example' : null };
      const raw = JSON.stringify(existing);
      await writeFile(filename, raw);
      const first = await queueSmartPublishJob('test-channel');
      const second = await queueSmartPublishJob('test-channel');
      assert.equal(first.id, existing.id);
      assert.equal(second.id, existing.id);
      assert.equal(first.externalPostUrl, existing.externalPostUrl);
      assert.equal(await readFile(filename, 'utf8'), raw);
    }
  } finally {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
