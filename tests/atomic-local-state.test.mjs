import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { withLocalStateLock, writeAtomicJson } from '../lib/atomic-local-state.mjs';
import { leaseOwner } from '../lib/process-lease.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-local-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, file: path.join(root, 'state.json') };
}

for (const contents of ['', '{"pid":']) {
  test(`a stale ${contents ? 'truncated' : 'empty'} state lock left by a crashed writer can recover`, async t => {
    const { file } = await fixture(t), lock = `${file}.mutation-lock`;
    await writeFile(lock, contents);
    const old = new Date(Date.now() - 600_000);
    await utimes(lock, old, old);
    assert.equal(await withLocalStateLock(file, async () => 42, { timeoutMs: 150, staleMs: 0 }), 42);
    await assert.rejects(readFile(lock), { code: 'ENOENT' });
  });
}

test('a fresh incomplete legacy lock and an old live owner remain protected', async t => {
  const { file } = await fixture(t), lock = `${file}.mutation-lock`;
  await writeFile(lock, '');
  await assert.rejects(withLocalStateLock(file, async () => assert.fail('stole a fresh lock'), { timeoutMs: 30, staleMs: 0 }), { code: 'STATE_BUSY' });
  await writeFile(lock, JSON.stringify(leaseOwner()));
  const old = new Date(Date.now() - 600_000);
  await utimes(lock, old, old);
  await assert.rejects(withLocalStateLock(file, async () => assert.fail('stole a live owner'), { timeoutMs: 30, staleMs: 0 }), { code: 'STATE_BUSY' });
});

test('state mutations serialize concurrent writers and release a failed operation', async t => {
  const { file, root } = await fixture(t);
  await writeAtomicJson(file, { value: 0 });
  await Promise.all(Array.from({ length: 8 }, () => withLocalStateLock(file, async () => {
    const saved = JSON.parse(await readFile(file, 'utf8'));
    await new Promise(resolve => setTimeout(resolve, 2));
    await writeAtomicJson(file, { value: saved.value + 1 });
  })));
  assert.equal(JSON.parse(await readFile(file, 'utf8')).value, 8);
  await assert.rejects(withLocalStateLock(file, async () => { throw new Error('failed operation'); }), /failed operation/);
  assert.equal(await withLocalStateLock(file, async () => 9), 9);
  assert.deepEqual(await readdir(root), ['state.json']);
});

test('failed atomic replacement does not leave a temporary metadata file', async t => {
  const { file, root } = await fixture(t);
  await mkdir(file);
  await assert.rejects(writeAtomicJson(file, { value: 1 }));
  assert.deepEqual(await readdir(root), ['state.json']);
});
