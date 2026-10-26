import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {releasePolicy,runtimeWorkerScripts} from '../lib/release-policy.mjs';
import {readRuntimeStatus,saveRuntimeStatus} from '../lib/runtime-status.mjs';
test('stable defaults preserve manual/local tools while experimental workers require two explicit flags',()=>{
 assert.equal(releasePolicy({}).channel,'stable');assert.equal(releasePolicy({}).features.manualTrim,true);assert.equal(releasePolicy({}).features.stories,false);
 assert.equal(releasePolicy({CLIPFORGE_EXPERIMENTAL_FEATURES:'true'}).experimental,false);
 const env={CLIPFORGE_RELEASE_CHANNEL:'development',CLIPFORGE_EXPERIMENTAL_FEATURES:'true'};assert.equal(releasePolicy(env).features.live,true);
 const stable=runtimeWorkerScripts({CLIPFORGE_MEDIA_STORAGE_PROVIDER:'r2'});assert.equal(stable[0],'scripts/render-worker.mjs');assert.ok(stable.includes('scripts/storage-worker.mjs'));assert.ok(!stable.some(s=>/agent|autopilot|news|owned-content/.test(s)));
 assert.ok(runtimeWorkerScripts(env).includes('scripts/owned-content-worker.mjs'));assert.ok(!stable.some(s=>/publishing/.test(s)));
});
test('a configured flag cannot masquerade as a live scheduler; evidence expires and is tied to a live process',async t=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-status-'));t.after(()=>rm(root,{recursive:true,force:true}));let clock=100000;
 assert.equal((await readRuntimeStatus({root})).running,false);
 await saveRuntimeStatus({status:'RUNNING',profile:'stable'},{root,now:()=>clock});
 assert.equal((await readRuntimeStatus({root,now:()=>clock,isAlive:()=>true})).running,true);
 assert.equal((await readRuntimeStatus({root,now:()=>clock,isAlive:()=>false})).running,false);
 clock+=31000;const stale=await readRuntimeStatus({root,now:()=>clock,isAlive:()=>true});assert.equal(stale.running,false);assert.equal('owner'in stale,false);
});
