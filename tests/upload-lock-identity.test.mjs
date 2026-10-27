import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ResumableUploadStore } from '../services/ingest/ResumableUploadStore.mjs';
import { leaseOwner } from '../lib/process-lease.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-upload-identity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ResumableUploadStore({ root });
  const session = await store.create({ filename: 'transport-fixture.mp4', mimeType: 'video/mp4', size: 8 });
  return { store, id: session.id, lock: path.join(store.directory(session.id), 'lock') };
}

test('an old upload lock with a live process identity cannot be stolen', async t => {
  const { store, id, lock } = await fixture(t);
  await writeFile(lock, JSON.stringify(leaseOwner()));
  const old = new Date(Date.now() - 600_000); await utimes(lock, old, old);
  await assert.rejects(store.lock(id, async () => assert.fail('live upload was interrupted')), { code: 'UPLOAD_BUSY' });
});

test('a retained upload lease from a different process start can recover even when its PID has been reused', async t => {
  const { store, id, lock } = await fixture(t);
  await writeFile(lock, JSON.stringify({ ...leaseOwner(), key: 'previous-boot-and-process-start' }));
  assert.equal(await store.lock(id, async () => 42), 42);
});

test('legacy numeric PID locks and fresh incomplete owner writes remain protected', async t => {
  const { store, id, lock } = await fixture(t);
  await writeFile(lock, String(process.pid));
  await assert.rejects(store.lock(id, async () => assert.fail('legacy live upload was interrupted')), { code: 'UPLOAD_BUSY' });
  await writeFile(lock, '');
  await assert.rejects(store.lock(id, async () => assert.fail('incomplete owner was stolen')), { code: 'UPLOAD_BUSY' });
});
