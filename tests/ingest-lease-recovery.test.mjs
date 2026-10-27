import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { IngestJobStore } from '../services/ingest/IngestJobStore.mjs';
import { leaseOwner } from '../lib/process-lease.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-ingest-leases-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  const store = new IngestJobStore(options);
  const queued = await store.create({ url: 'https://example.com/authorized.mp4', mode: 'IMPORT' });
  return { root, store, queued, lock: path.join(root, 'ingest-jobs', `${queued.id}.lock`) };
}

test('a slow live ingest owner keeps its lease after the stale heartbeat threshold', async t => {
  const { store, queued, lock } = await fixture(t, { staleAfterMs: 1 });
  await store.claimNext();
  await writeFile(lock, JSON.stringify(leaseOwner()));
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  assert.equal(await new IngestJobStore({ staleAfterMs: 1 }).claimNext(), null);
  assert.equal((await store.get(queued.id)).attempts, 1);
});

test('a confirmed dead ingest owner recovers without waiting for a fresh heartbeat to age', async t => {
  const { store, queued, lock } = await fixture(t);
  await store.claimNext();
  await writeFile(lock, JSON.stringify({ pid: 2147483647, key: 'dead-process' }));
  const recovered = await new IngestJobStore().claimNext();
  assert.equal(recovered?.id, queued.id);
  assert.equal(recovered.attempts, 2);
});

test('a crashed claim before PROCESSING does not leave a queued upload permanently locked', async t => {
  const { store, queued, lock } = await fixture(t);
  await writeFile(lock, JSON.stringify({ pid: 2147483647, key: 'dead-process' }));
  assert.equal((await store.claimNext())?.id, queued.id);
});

test('a late ingest heartbeat cannot recreate a released worker lease', async t => {
  const { store, lock } = await fixture(t);
  const job = await store.claimNext();
  await store.complete(job, { projectId: job.projectId });
  assert.equal(await store.heartbeat(job.id), false);
  await assert.rejects(stat(lock), { code: 'ENOENT' });
});

test('a cancelled live worker cannot be retried just because its heartbeat is old', async t => {
  const { store, lock } = await fixture(t, { staleAfterMs: 1 });
  const job = await store.claimNext();
  await store.cancel(job.id);
  await writeFile(lock, JSON.stringify(leaseOwner()));
  const old = new Date(Date.now() - 60_000);
  await utimes(lock, old, old);
  await assert.rejects(store.retry(job.id), /deteniéndose/);
  assert.equal((await store.get(job.id)).status, 'CANCELLED');
});

test('completion from a prior attempt cannot replace the result or lease of a resumed attempt', async t => {
  const { store, lock } = await fixture(t);
  const previous = await store.claimNext();
  await store.cancel(previous.id);
  // Simulate the old worker's lease being released after its process exited.
  await store.release(previous.id);
  await store.retry(previous.id);
  const resumed = await store.claimNext();
  const resumedLock = await readFile(lock, 'utf8');
  assert.equal((await store.complete(previous, { wrongAttempt: true })).status, 'PROCESSING');
  assert.equal((await store.fail(previous, new Error('late failure'))).status, 'PROCESSING');
  assert.equal(await readFile(lock, 'utf8'), resumedLock);
  const complete = await store.complete(resumed, { projectId: resumed.projectId });
  assert.deepEqual(complete.result, { projectId: resumed.projectId });
});

test('a real terminated ingest process is recovered exactly once while a live process remains protected', async t => {
  const { store, queued, lock } = await fixture(t, { staleAfterMs: 1 });
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { IngestJobStore } from './services/ingest/IngestJobStore.mjs';
    const job = await new IngestJobStore().claimNext();
    process.stdout.write(job.id + '\\n');
    setInterval(() => {}, 1000);
  `], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const childReady = new Promise((resolve, reject) => {
    child.stdout.once('data', message => resolve([message]));
    child.once('error', reject);
    child.once('exit', () => reject(new Error('The fixture worker exited before claiming the job.')));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000); timeout.unref();
  t.after(() => clearTimeout(timeout));
  const [message] = await childReady;
  assert.equal(message.toString().trim(), queued.id);
  const old = new Date(Date.now() - 60_000); await utimes(lock, old, old);
  assert.equal(await store.claimNext(), null, 'An actual live child owns this ingest');
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const claims = await Promise.all([new IngestJobStore().claimNext(), new IngestJobStore().claimNext()]);
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(claims.find(Boolean).id, queued.id);
  assert.equal(claims.find(Boolean).attempts, 2);
  assert.equal(await store.claimNext(), null);
});

test('timestamp leases from an older installation still recover after their timeout', async t => {
  const { store, queued, lock } = await fixture(t, { staleAfterMs: 1 });
  await store.claimNext();
  await writeFile(lock, new Date().toISOString());
  const old = new Date(Date.now() - 60_000); await utimes(lock, old, old);
  assert.equal((await store.claimNext())?.id, queued.id);
});
