import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {LiveArchiveService} from '../services/live/LiveArchiveService.mjs';
import {LiveSessionStore,liveId} from '../services/live/LiveSessionStore.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {MemoryObjectStore} from './helpers/memory-object-store.mjs';
const source={channel:'owned',channelId:'123',sourceId:'test-owned-1',sourceKind:'LIVE',startedAt:'2026-10-25T00:00:00Z'};
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-checkpoint-')),id=liveId(root),sessions=new LiveSessionStore({root}),cloud=new MemoryObjectStore(),library=new ClipLibraryService({store:cloud});await sessions.create(id,source);const service=new LiveArchiveService({root,sessions,cloud,library,mediaJobs:{get:async()=>null}});t.after(()=>rm(root,{recursive:true,force:true}));return{root,id,sessions,cloud,service};}
test('checkpoint is idempotent, verifies hashes, restores stopped workers and marks unarchived originals missing',async t=>{
  const f=await fixture(t);await f.sessions.addSegment(f.id,{index:0,relativePath:`live-sessions/${f.id}/capture/.stream-parts/part-000000.ts`,sha256:'a'.repeat(64),durationSeconds:30,sizeBytes:20,sourceStartUtc:source.startedAt,closedAt:source.startedAt});
  await mkdir(path.join(f.root,'live-monitor'),{recursive:true});await writeFile(path.join(f.root,'live-monitor','westcol.json'),JSON.stringify({version:1,status:'CAPTURING',pausedByOwner:false}));
  const one=await f.service.checkpoint(f.id),count=f.cloud.objects.size,two=await f.service.checkpoint(f.id);assert.equal(one.createdAt,two.createdAt);assert.equal(f.cloud.objects.size,count);
  const target=path.join(f.root,'restored');const result=await f.service.restore(f.id,{targetRoot:target,workersPaused:true});assert.equal(result.workersStarted,false);const monitor=JSON.parse(await readFile(path.join(target,'live-monitor','westcol.json'),'utf8'));assert.equal(monitor.pausedByOwner,true);assert.equal(monitor.status,'RESTORED_PAUSED');
  const state=await new LiveSessionStore({root:target}).get(f.id);assert.equal(state.capture.status,'RESTORED_PAUSED');assert.equal(state.segments[0].status,'MISSING_AFTER_RESTORE');assert.equal(state.gaps[0].reason,'UNARCHIVED_ORIGINALS_NOT_IN_CHECKPOINT');assert.equal(f.cloud.deletes.length,0);
  await assert.rejects(f.service.restore(f.id,{targetRoot:target}),/workers detenidos/);
});
test('restore rejects path traversal, checksum changes and pre-existing conflicting state without overwriting it',async t=>{
  const f=await fixture(t),checkpoint=await f.service.checkpoint(f.id),target=path.join(f.root,'target'),entry=checkpoint.files[0];
  const file=path.join(target,entry.relativePath);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,'existing unrelated state');
  await assert.rejects(f.service.restore(f.id,{targetRoot:target,workersPaused:true}),/no se sobrescriben/);assert.equal(await readFile(file,'utf8'),'existing unrelated state');
  const object=f.cloud.objects.get(entry.key);object.body=Buffer.from('corrupted');object.size=9;
  await assert.rejects(f.service.restore(f.id,{targetRoot:path.join(f.root,'checksum'),workersPaused:true}),/SHA-256|tamaño/);
  const bad={...checkpoint,files:[{...entry,relativePath:'../outside.json',sha256:createHash('sha256').update('x').digest('hex')}]};await f.cloud.putJson(`clipforge-managed/v1/checkpoints/${f.id}/latest.json`,bad);
  await assert.rejects(f.service.restore(f.id,{targetRoot:path.join(f.root,'traversal'),workersPaused:true}),/ruta o huella/);
});
