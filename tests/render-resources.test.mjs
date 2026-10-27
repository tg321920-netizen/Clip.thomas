import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,utimes} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {manualOutputOptions,automaticOutputOptions,ENCODER_QUALITY,renderThreads} from '../lib/render-options.mjs';
import {withRenderCapacity} from '../lib/render-capacity.mjs';
import {JobStore} from '../services/JobStore.mjs';
import {leaseOwner} from '../lib/process-lease.mjs';
test('manual output keeps 720p/1080p and horizontal/vertical separate; invalid profiles never become oversized jobs',()=>{
  assert.deepEqual(manualOutputOptions({aspectRatio:'16:9',resolution:'1080p'}),{width:1920,height:1080,aspectRatio:'16:9',resolution:'1080p'});
  assert.equal(manualOutputOptions({resolution:'720p'}).height,1280);
  assert.equal(manualOutputOptions({},{}).width,1080);
  assert.throws(()=>manualOutputOptions({resolution:'4k'}),/720p/);
  assert.throws(()=>manualOutputOptions({aspectRatio:'custom'}),/formato/);
  assert.equal(ENCODER_QUALITY.EFFICIENT.crf,ENCODER_QUALITY.BALANCED.crf);
  assert.equal(ENCODER_QUALITY.EFFICIENT.preset,'veryfast');
  assert.equal(renderThreads({CLIPFORGE_RENDER_THREADS:'999'}),2);
});
test('automatic output supports all four owner profiles and preserves legacy internal dimensions',()=>{
  assert.deepEqual(automaticOutputOptions({format:'16:9',resolution:'720p'}),{width:1280,height:720,aspectRatio:'16:9',resolution:'720p'});
  assert.equal(automaticOutputOptions({format:'16:9',resolution:'1080p'}).width,1920);
  assert.equal(automaticOutputOptions({format:'9:16',resolution:'720p'}).height,1280);
  assert.equal(automaticOutputOptions({format:'9:16',resolution:'1080p'}).height,1920);
  assert.deepEqual(automaticOutputOptions({}, {width:360,height:640}),{width:360,height:640});
  assert.equal(automaticOutputOptions({format:'16:9'}, {width:720,height:1280}).width,1280);
  assert.throws(()=>automaticOutputOptions({format:'16:9',aspectRatio:'9:16'}),/dos formatos/);
  assert.throws(()=>automaticOutputOptions({resolution:'4k'}),/720p/);
});
test('independent render calls share one slot, apply backpressure, and release capacity after an error',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-render-slot-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let release,entered;const ready=new Promise(resolve=>{entered=resolve;}),wait=new Promise(resolve=>{release=resolve;});
  const first=withRenderCapacity(async()=>{entered();await wait;return 42;},{root});await ready;
  await assert.rejects(withRenderCapacity(async()=>assert.fail('second encoder ran'),{root}),e=>e.code==='RENDER_CAPACITY_BUSY');
  release();assert.equal(await first,42);
  await assert.rejects(withRenderCapacity(async()=>{throw new Error('encoder failure');},{root}),/encoder failure/);
  assert.equal(await withRenderCapacity(async()=>7,{root}),7);
});
test('render leases recover dead processes immediately but never steal a live slow encoder',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-render-restart-')),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  const jobs=new JobStore(),id=randomUUID(),clip=randomUUID();await jobs.enqueueRender(id,clip);
  const claimed=await jobs.claimNext(['RENDER_CLIP']),lock=path.join(root,'jobs',claimed.id+'.lock');
  await writeFile(lock,JSON.stringify(leaseOwner()));const old=new Date(Date.now()-3600000);await utimes(lock,old,old);
  assert.equal(await jobs.claimNext(['RENDER_CLIP']),null);
  await writeFile(lock,JSON.stringify({pid:2147483647,key:'dead-process'}));
  const recovered=await jobs.claimNext(['RENDER_CLIP']);assert.equal(recovered.id,claimed.id);assert.equal(recovered.stage,'RECOVERED');
});
