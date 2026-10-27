import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, stat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { ClipLibraryService, getClipLibraryStatus, readClipArchiveHealth } from '../services/storage/ClipLibraryService.mjs';
import { MemoryObjectStore } from './helpers/memory-object-store.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clip-library-'));
  const previous = process.env.CLIPFORGE_STORAGE_DIR; process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(async () => { if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous; await rm(root, { recursive: true, force: true }); });
  const project = { id: randomUUID(), source: { originalName: 'Authorized fixture' } };
  const clipId = randomUUID(), relativePath = `clips/${project.id}/${clipId}/render.mp4`;
  const filename = path.join(root, relativePath); await mkdir(path.dirname(filename), { recursive: true });
  const bytes = Buffer.from('opaque test payload for storage integrity, not a playable media fixture');
  await writeFile(filename, bytes);
  const clip = { id: clipId, status: 'READY', title: 'Fixture moment', duration: 30, render: { relativePath, archiveEligible: true, validation: { valid: true } } };
  const store = new MemoryObjectStore(); let now = Date.parse('2026-10-24T12:00:00Z');
  const service = new ClipLibraryService({ store, now: () => now });
  return { root, project, clip, store, service, filename, bytes, advance: ms => { now += ms; } };
}

test('archive is idempotent and a fresh instance can list, range-stream and download after local files vanish', async t => {
  const f = await fixture(t);
  const saved = await f.service.archive(f.project, f.clip);
  f.advance(86400000);
  const again = await f.service.archive(f.project, f.clip);
  assert.equal(again.id, saved.id); assert.equal(again.expiresAt, saved.expiresAt); assert.equal(f.store.uploads, 1);
  await rm(f.root, { recursive: true, force: true });
  const restored = new ClipLibraryService({ store: f.store });
  assert.equal((await restored.list()).clips[0].id, saved.id);
  const downloaded = await restored.source(saved.id);
  const chunks = []; for await (const chunk of downloaded.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), f.bytes);
  const range = await restored.source(saved.id, 'bytes=0-3');
  assert.equal(range.contentRange, `bytes 0-3/${f.bytes.length}`);
  const parts = []; for await (const chunk of range.body) parts.push(chunk);
  assert.deepEqual(Buffer.concat(parts), f.bytes.subarray(0, 4));
  await assert.rejects(restored.source(saved.id, 'bytes=999999-'), error => error.code === 'STORAGE_RANGE');
});

test('audio-only archives keep their kind and bytes across a fresh library instance',async t=>{
  const f=await fixture(t);f.project.source.mediaKind='AUDIO';f.clip.render.mediaKind='AUDIO';
  const saved=await f.service.archive(f.project,f.clip);assert.equal(saved.mediaKind,'AUDIO');assert.equal(saved.origin.kind,'AUDIO');
  const second=new ClipLibraryService({store:f.store});const loaded=await second.identity(saved.id);assert.equal(loaded.mediaKind,'AUDIO');
  const downloaded=await second.source(saved.id);const parts=[];for await(const part of downloaded.body)parts.push(part);
  assert.deepEqual(Buffer.concat(parts),f.bytes);assert.equal((await f.service.archive(f.project,f.clip)).id,saved.id);assert.equal(f.store.uploads,1);
});

test('cleanup preserves MP4 referenced by a private project checkpoint even after ordinary retention expires',async t=>{
  const f=await fixture(t),saved=await f.service.archive(f.project,f.clip);
  await f.store.putJson('clipforge-managed/v1/project-recovery/'+f.project.id+'.json',
    {version:1,id:f.project.id,outputs:[{key:'clipforge-managed/v1/media/'+saved.id+'.mp4'}]});
  f.advance(31*86400000);
  assert.deepEqual((await f.service.cleanup()).removed,[]);
  assert.equal(f.store.deletes.length,0);
  assert.equal((await f.service.identity(saved.id)).status,'READY');
});

test('new story renders are archived only at the exact managed story path', async t => {
  const f = await fixture(t);
  f.project.story = { title: 'Reflexión propia' };
  f.project.source.relativePath = `stories/${f.project.id}/render.mp4`;
  f.clip.candidateId = 'story'; f.clip.render.relativePath = f.project.source.relativePath;
  const filename = path.join(f.root, f.project.source.relativePath);
  await mkdir(path.dirname(filename), { recursive: true }); await writeFile(filename, f.bytes);
  const saved = await f.service.archive(f.project, f.clip);
  assert.equal(saved.status, 'READY');
  delete f.project.story;
  await assert.rejects(f.service.archive(f.project, f.clip), error => error.code === 'STORAGE_INVALID');
});

test('only opted-in validated new renders are archived; legacy and foreign bucket objects are untouched', async t => {
  const f = await fixture(t);
  const legacy = structuredClone(f.clip); delete legacy.render.archiveEligible;
  assert.equal(await f.service.archive(f.project, legacy), null);
  assert.equal(await f.service.archive(f.project, { ...f.clip, status: 'PROCESSING' }), null);
  await f.store.put('legacy/original.mp4', Buffer.from('keep forever'));
  await f.service.archive(f.project, f.clip); f.advance(31 * 86400000);
  await f.service.cleanup();
  assert.ok(f.store.objects.has('legacy/original.mp4'));
  assert.ok(!f.store.deletes.includes('legacy/original.mp4'));
});

test('30-day cleanup honors Conservar, dry runs, and renewed retention after unpinning', async t => {
  const f = await fixture(t);
  const saved = await f.service.archive(f.project, f.clip);
  await f.service.setKeep(saved.id, true); f.advance(31 * 86400000);
  assert.deepEqual((await f.service.cleanup()).removed, []);
  assert.equal((await f.service.list()).clips[0].keep, true);
  const unpinned = await f.service.setKeep(saved.id, false);
  assert.ok(Date.parse(unpinned.expiresAt) > Date.parse(saved.expiresAt));
  f.advance(30 * 86400000 + 1);
  assert.deepEqual((await f.service.cleanup({ dryRun: true })).removed, [saved.id]);
  assert.equal(f.store.deletes.length, 0);
  assert.deepEqual((await f.service.cleanup()).removed, [saved.id]);
  assert.equal((await f.service.list()).clips.length, 0);
  await assert.rejects(f.service.source(saved.id), error => error.code === 'STORAGE_NOT_FOUND');
  await f.service.archive(f.project, f.clip);
  assert.equal(f.store.uploads, 1, 'maintenance must not resurrect deleted versions');
});

test('failed manifest writes preserve local media; retry adopts the verified upload without duplicate objects', async t => {
  const f = await fixture(t); f.store.failPut = key => key.includes('/records/');
  await assert.rejects(f.service.archive(f.project, f.clip));
  assert.equal((await stat(f.filename)).size, f.bytes.length);
  assert.equal(f.store.uploads, 1); f.store.failPut = null;
  const recovered = await f.service.archive(f.project, f.clip);
  assert.equal(recovered.status, 'READY'); assert.equal(f.store.uploads, 1);
});

test('quota exhaustion never deletes a protected clip or the local result', async t => {
  const f = await fixture(t); const saved = await f.service.archive(f.project, f.clip);
  await f.service.setKeep(saved.id, true);
  const small = new ClipLibraryService({ store: f.store, maxBytes: 1 });
  const other = { ...f.clip, id: randomUUID() }; other.render = { ...f.clip.render, relativePath: `clips/${f.project.id}/${other.id}/render.mp4` };
  await mkdir(path.dirname(path.join(f.root, other.render.relativePath)), { recursive: true }); await writeFile(path.join(f.root, other.render.relativePath), f.bytes);
  await assert.rejects(small.archive(f.project, other), error => error.code === 'STORAGE_QUOTA');
  assert.equal(f.store.deletes.length, 0); assert.equal((await stat(f.filename)).size, f.bytes.length);
  assert.throws(() => new ClipLibraryService({ store: f.store, maxBytes: 10_000_000_000 }));
});

test('Conservar and cleanup are serialized across service instances', async t => {
  const f = await fixture(t); const saved = await f.service.archive(f.project, f.clip); f.advance(31 * 86400000);
  let resume; const gate = new Promise(resolve => { resume = resolve; }); let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const original = f.store.putJson.bind(f.store);
  f.store.putJson = async (key, value, options) => {
    if (key.includes('/records/') && value.keep === true) { entered(); await gate; }
    return original(key, value, options);
  };
  const keeping = f.service.setKeep(saved.id, true); await started;
  await assert.rejects(new ClipLibraryService({ store: f.store }).cleanup(), error => error.code === 'STORAGE_BUSY');
  resume(); await keeping;
  assert.deepEqual((await f.service.cleanup()).removed, []); assert.equal(f.store.deletes.length, 0);
});

test('corrupt metadata stops cleanup before any deletion, and failed deletions remain retryable', async t => {
  const f = await fixture(t); const saved = await f.service.archive(f.project, f.clip); f.advance(31 * 86400000);
  const key = `clipforge-managed/v1/records/${saved.id}.json`;
  const record = (await f.store.getJson(key)).value;
  await f.store.putJson(key, { ...record, objectKey: 'legacy/foreign.mp4' });
  await assert.rejects(f.service.cleanup(), error => error.code === 'STORAGE_INVALID'); assert.equal(f.store.deletes.length, 0);
  await f.store.putJson(key, record); f.store.failDelete = true;
  await assert.rejects(f.service.cleanup()); assert.equal((await f.service.list()).clips.length, 1);
  f.store.failDelete = false; assert.deepEqual((await f.service.cleanup()).removed, [saved.id]);
});

test('storage status is explicit and never discloses credentials', () => {
  assert.equal(getClipLibraryStatus({}).configured, false);
  const missing = getClipLibraryStatus({ CLIPFORGE_MEDIA_STORAGE_PROVIDER: 'r2', CLIPFORGE_R2_SECRET_ACCESS_KEY: 'fixture-secret-do-not-display' });
  assert.equal(missing.configured, false); assert.ok(!JSON.stringify(missing).includes('fixture-secret-do-not-display'));
});

test('an object changed outside the library is neither streamed as the verified clip nor deleted', async t => {
  const f = await fixture(t); const saved = await f.service.archive(f.project, f.clip);
  const key = `clipforge-managed/v1/media/${saved.id}.mp4`;
  await f.store.put(key, Buffer.from('unexpected replacement'), { metadata: { sha256: 'not the verified content' } });
  await assert.rejects(f.service.source(saved.id), error => error.code === 'STORAGE_CONFLICT');
  await assert.rejects(f.service.setKeep(saved.id, true), error => error.code === 'STORAGE_INTEGRITY');
  f.advance(31 * 86400000);
  await assert.rejects(f.service.cleanup(), error => error.code === 'STORAGE_INTEGRITY');
  assert.equal(f.store.deletes.length, 0);
});

test('a missing protected object is restored from the local render without losing its protection', async t => {
  const f = await fixture(t); const saved = await f.service.archive(f.project, f.clip);
  await f.service.setKeep(saved.id, true);
  await f.store.delete(`clipforge-managed/v1/media/${saved.id}.mp4`);
  const restored = await f.service.archive(f.project, f.clip);
  assert.equal(restored.keep, true);
  const result = await f.service.source(restored.id); const chunks = [];
  for await (const chunk of result.body) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), f.bytes);
});

test('archive failures reach the UI without exposing receipt details or credentials', async t => {
  const f = await fixture(t);
  const env = { CLIPFORGE_MEDIA_STORAGE_PROVIDER: 'r2', CLIPFORGE_R2_ACCOUNT_ID: 'a'.repeat(32), CLIPFORGE_R2_BUCKET: 'fixture-clips', CLIPFORGE_R2_ACCESS_KEY_ID: 'fixture-id', CLIPFORGE_R2_SECRET_ACCESS_KEY: 'fixture-private-secret' };
  const destination = createHash('sha256').update(`${env.CLIPFORGE_R2_ACCOUNT_ID}/${env.CLIPFORGE_R2_BUCKET}`).digest('hex');
  await writeFile(path.join(f.root, 'cloud-clip-receipts.json'), JSON.stringify({ destination, failures: { one: { message: env.CLIPFORGE_R2_SECRET_ACCESS_KEY } } }));
  const health = await readClipArchiveHealth({ root: f.root, env });
  assert.equal(health.pendingCount, 1); assert.match(health.warning, /reintentar/);
  assert.ok(!JSON.stringify(health).includes(env.CLIPFORGE_R2_SECRET_ACCESS_KEY));
});

test('review remains pending until owner action, rejection keeps bytes, and preservation does not approve',async t=>{
  const f=await fixture(t),saved=await f.service.archive(f.project,f.clip);
  assert.equal(saved.review.status,'PENDING');
  const rejected=await f.service.setReview(saved.id,'REJECTED');assert.equal(rejected.review.status,'REJECTED');
  assert.equal((await f.service.setKeep(saved.id,true)).review.status,'REJECTED');
  assert.ok(await f.store.head(`clipforge-managed/v1/media/${saved.id}.mp4`));
  assert.equal(f.store.deletes.length,0);
  await assert.rejects(f.service.setReview(saved.id,'APPROVED'));
  const pending=await f.service.setReview(saved.id,'PENDING');assert.equal(pending.review.status,'PENDING');
});

test('explicit QA provenance stays out of the owner library without deleting media, and titles cannot hide a real clip',async t=>{
 const f=await fixture(t);f.clip.title='PRUEBA TÉCNICA es parte de una conversación real';
 f.project.source.originUrl='https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6?private=must-not-persist';f.project.source.ingestMode='STREAM';f.project.liveObservation={channel:'westcol',sourceKind:'VOD'};
 const real=await f.service.archive(f.project,f.clip);assert.equal(real.origin.kind,'STREAM');assert.equal(real.origin.sourceKind,'VOD');assert.equal((await f.service.list()).clips.length,1);assert.doesNotMatch(JSON.stringify(real.origin),/private|must-not-persist/);
 f.project.testOnly=true;const qa=await f.service.archive(f.project,f.clip);assert.equal(qa.origin.kind,'TECHNICAL_TEST');assert.equal((await f.service.list()).clips.length,0);assert.equal((await f.service.list({includeTechnicalTests:true})).clips.length,1);assert.ok(await f.store.head(`clipforge-managed/v1/media/${real.id}.mp4`));assert.equal(f.store.deletes.length,0);
 delete f.project.testOnly;assert.equal((await f.service.archive(f.project,f.clip)).origin.kind,'TECHNICAL_TEST','a retry must not reintroduce a QA fixture');
});
