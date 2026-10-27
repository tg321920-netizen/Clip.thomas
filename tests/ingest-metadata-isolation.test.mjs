import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { IngestJobStore } from '../services/ingest/IngestJobStore.mjs';
import { liveStatus } from '../services/live/LiveStatusService.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-ingest-metadata-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR; process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const store = new IngestJobStore(), healthy = await store.create({ url: 'https://example.com/authorized.mp4', mode: 'IMPORT' });
  return { root, store, healthy };
}

test('one damaged ingest record cannot stop healthy pending imports and its bytes remain untouched', async t => {
  const { root, store, healthy } = await fixture(t), badId = randomUUID(), broken = '{"private":"https://private.invalid/signed?token=do-not-expose"';
  const file = path.join(root, 'ingest-jobs', `${badId}.json`); await writeFile(file, broken);
  assert.equal((await store.claimNext())?.id, healthy.id);
  assert.equal(await readFile(file, 'utf8'), broken);
  const history = await store.listWithIssues();
  assert.equal(history.jobs.length, 1); assert.equal(history.issues.length, 1); assert.equal(history.issues[0].id, badId);
  assert.doesNotMatch(JSON.stringify(history.issues), /private\.invalid|token|do-not-expose/);
});

test('mismatched or incomplete metadata is not treated as a valid completed import', async t => {
  const { root, store, healthy } = await fixture(t), badId = randomUUID();
  await writeFile(path.join(root, 'ingest-jobs', `${badId}.json`), JSON.stringify({ ...healthy, id: 'another-id', status: 'COMPLETED' }));
  await assert.rejects(store.get(badId), { code: 'INGEST_METADATA_INVALID' });
  assert.equal((await store.listWithIssues()).issues.length, 1);
  assert.equal((await store.claimNext())?.id, healthy.id);
});

test('live status counts damaged ingestion records without exposing their saved source payload', async t => {
  const { root, store } = await fixture(t), badId = randomUUID();
  await writeFile(path.join(root, 'ingest-jobs', `${badId}.json`), '{"secret":"must-not-leak"');
  const state = await liveStatus({ sessions: { list: async () => [], capacity: async () => ({ allowed: true }) }, ingests: store,
    media: { listMediaWithIssues: async () => ({ jobs: [], issues: [] }) }, monitorStore: { read: async () => ({ status: 'DISABLED' }) },
    resolveStatus: async () => ({ status: 'OFFLINE', checkedAt: new Date().toISOString() }), env: {} });
  assert.equal(state.metadataIssueCount, 1);
  assert.doesNotMatch(JSON.stringify(state), /must-not-leak/);
});
