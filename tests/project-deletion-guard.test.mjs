import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {assertProjectDeletionSafe} from '../lib/project-deletion-guard.mjs';
const id='8e56073f-ae3a-4c2c-a73d-b11085dbd1b6';
test('deleting an original is blocked while another project or unfinished batch references it',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-delete-guard-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'projects'));await mkdir(path.join(root,'jobs'));
  await assertProjectDeletionSafe(id,{root});
  const shared=path.join(root,'projects','other.json');await writeFile(shared,JSON.stringify({source:{relativePath:`uploads/${id}/source.mp4`}}));
  await assert.rejects(assertProjectDeletionSafe(id,{root}),{code:'PROJECT_IN_USE'});await rm(shared);
  const batch=path.join(root,'jobs','batch.json');await writeFile(batch,JSON.stringify({projectId:'another-project',payload:{projectId:id},status:'PROCESSING'}));
  await assert.rejects(assertProjectDeletionSafe(id,{root}),{code:'PROJECT_IN_USE'});
  await writeFile(batch,JSON.stringify({projectId:id,status:'WAITING_RESOURCE'}));await assert.rejects(assertProjectDeletionSafe(id,{root}),{code:'PROJECT_IN_USE'});
  await writeFile(batch,JSON.stringify({projectId:id,status:'COMPLETED'}));await assertProjectDeletionSafe(id,{root});
  await writeFile(shared,'broken metadata');await assert.rejects(assertProjectDeletionSafe(id,{root}),{code:'PROJECT_IN_USE'});
});

test('an unrelated long transcript within the recovery metadata limit does not block all project deletions', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-long-delete-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'projects'));
  await writeFile(path.join(root, 'projects', 'other.json'), JSON.stringify({ source: { relativePath: 'uploads/unrelated/source.mp4' }, transcript: { segments: [{ text: 'a'.repeat(2_100_000) }] } }));
  await assertProjectDeletionSafe(id, { root });
});

test('an original still being finalized by an ingest worker cannot be deleted', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'clipforge-ingest-delete-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'ingest-jobs'));
  const job = path.join(root, 'ingest-jobs', `${id}.json`);
  await writeFile(job, JSON.stringify({ projectId: id, type: 'INGEST_UPLOAD', status: 'PROCESSING' }));
  await assert.rejects(assertProjectDeletionSafe(id, { root }), { code: 'PROJECT_IN_USE' });
  await writeFile(job, JSON.stringify({ projectId: id, type: 'INGEST_UPLOAD', status: 'COMPLETED' }));
  await assertProjectDeletionSafe(id, { root });
});
