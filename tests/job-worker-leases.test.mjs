import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { JobStore } from '../services/JobStore.mjs';
import { leaseOwner } from '../lib/process-lease.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-worker-leases-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(async () => {
    if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  });
  return { root, store: new JobStore(options), projectId: randomUUID() };
}

test('a slow transcription or analysis process cannot lose its lease based only on mtime', async t => {
  const { root, store, projectId } = await fixture(t, { staleAfterMs: 1 });
  for (const type of ['TRANSCRIBE_VIDEO', 'ANALYZE_VIDEO', 'AUTO_EDIT', 'RENDER_NEWS']) {
    const queued = await store.enqueue(type, projectId);
    const claimed = await store.claimNext([type]);
    const lock = path.join(root, 'jobs', `${queued.id}.lock`);
    await writeFile(lock, JSON.stringify(leaseOwner()));
    const old = new Date(Date.now() - 60_000); await utimes(lock, old, old);
    assert.equal(await store.claimNext([type]), null, `${type} still has a live owner`);
    await store.complete(claimed);
  }
});

test('dead analysis owners and old analysis jobs without a lease are recoverable', async t => {
  const { root, store, projectId } = await fixture(t, { staleAfterMs: 1 });
  const queued = await store.enqueueAnalysis(projectId);
  await store.claimNext(['ANALYZE_VIDEO']);
  const lock = path.join(root, 'jobs', `${queued.id}.lock`);
  await writeFile(lock, JSON.stringify({ pid: 2147483647, key: 'dead-process' }));
  assert.equal((await store.claimNext(['ANALYZE_VIDEO']))?.attempts, 2);
  await rm(lock);
  const file = path.join(root, 'jobs', `${queued.id}.json`);
  const saved = JSON.parse(await readFile(file, 'utf8'));
  await writeFile(file, JSON.stringify({ ...saved, updatedAt: '2000-01-01T00:00:00.000Z' }));
  assert.equal((await store.claimNext(['ANALYZE_VIDEO']))?.attempts, 3);
});

test('stale render completion cannot overwrite a newer attempt or remove its lock', async t => {
  const { root, store, projectId } = await fixture(t);
  const queued = await store.enqueueRender(projectId, randomUUID());
  const previous = await store.claimNext(['RENDER_CLIP']);
  await store.fail(previous, new Error('controlled failure'), { retryable: false });
  await store.enqueueRender(projectId, queued.entityId);
  const resumed = await store.claimNext(['RENDER_CLIP']);
  const lock = path.join(root, 'jobs', `${queued.id}.lock`), before = await readFile(lock, 'utf8');
  assert.equal((await store.complete(previous)).status, 'PROCESSING');
  assert.equal((await store.fail(previous, new Error('late failure'))).status, 'PROCESSING');
  assert.equal(await readFile(lock, 'utf8'), before);
  assert.equal((await store.complete(resumed)).status, 'COMPLETED');
});

test('a delayed progress write cannot resurrect a completed job', async t => {
  const { store, projectId } = await fixture(t);
  await store.enqueueTranscription(projectId);
  const claimed = await store.claimNext(['TRANSCRIBE_VIDEO']);
  let entered, release;
  const ready = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const actualGet = store.get.bind(store); let intercept = true;
  store.get = async id => {
    const job = await actualGet(id);
    if (intercept) { intercept = false; entered(); await gate; }
    return job;
  };
  const progress = store.updateProgress(claimed.id, 75); await ready;
  const complete = new JobStore().complete(claimed);
  // Force the terminal update into the interval between read and write.
  await new Promise(resolve => setTimeout(resolve, 35)); release();
  await Promise.all([progress, complete]);
  assert.equal((await actualGet(claimed.id)).status, 'COMPLETED');
});

test('worker crash recovery stops at the configured maximum attempts', async t => {
  const { root, store, projectId } = await fixture(t, { maxAttempts: 1 });
  const queued = await store.enqueueMedia('MEDIA_EDIT', projectId);
  await store.claimNext(['MEDIA_EDIT']);
  await writeFile(path.join(root, 'jobs', `${queued.id}.lock`), JSON.stringify({ pid: 2147483647, key: 'dead-process' }));
  assert.equal(await store.claimNext(['MEDIA_EDIT']), null);
  assert.equal((await store.get(queued.id)).status, 'FAILED');
  assert.equal((await store.get(queued.id)).nextAttemptAt, null);
});

test('analysis worker recovery uses an actual child process exit without starting any model', async t => {
  const { root, store, projectId } = await fixture(t, { staleAfterMs: 1 });
  const queued = await store.enqueueAnalysis(projectId);
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--input-type=module', '-e', `
    import { JobStore } from './services/JobStore.mjs';
    const job = await new JobStore().claimNext(['ANALYZE_VIDEO']);
    process.stdout.write(job.id + '\\n'); setInterval(() => {}, 1000);
  `], { cwd: process.cwd(), env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); });
  const ready = new Promise((resolve, reject) => {
    child.stdout.once('data', resolve); child.once('error', reject);
    child.once('exit', () => reject(new Error('The fixture worker exited before claiming the job.')));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 5000); timeout.unref();
  t.after(() => clearTimeout(timeout));
  assert.equal((await ready).toString().trim(), queued.id);
  const old = new Date(Date.now() - 60_000); await utimes(path.join(root, 'jobs', `${queued.id}.lock`), old, old);
  assert.equal(await store.claimNext(['ANALYZE_VIDEO']), null);
  const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited;
  const recovered = await store.claimNext(['ANALYZE_VIDEO']);
  assert.equal(recovered.id, queued.id); assert.equal(recovered.attempts, 2);
  assert.equal(await new JobStore().claimNext(['ANALYZE_VIDEO']), null);
});

test('100 percent is reserved for terminal completion rather than decoder progress', async t => {
  const { store, projectId } = await fixture(t);
  await store.enqueueTranscription(projectId); const job = await store.claimNext(['TRANSCRIBE_VIDEO']);
  const processing = await store.updateProgress(job.id, 100);
  assert.equal(processing.status, 'PROCESSING'); assert.equal(processing.progress, 99);
  const complete = await store.complete(job);
  assert.equal(complete.status, 'COMPLETED'); assert.equal(complete.progress, 100);
});
