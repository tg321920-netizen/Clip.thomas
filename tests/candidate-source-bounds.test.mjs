import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {replaceProjectFile,loadProjectFile} from '../lib/project-files.mjs';
import {createClipFromCandidate,createManualClip,renderClip} from '../services/clip/ClipService.mjs';
const id='8e56073f-ae3a-4c2c-a73d-b11085dbd1b6';
async function fixture(t){const root=await mkdtemp(path.join(os.tmpdir(),'cf-candidate-source-')),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
 t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
 return {id,source:{durationSeconds:120,hasAudio:true,audioDurationSeconds:119.8},clips:[],analysis:{candidates:[]}};}
test('candidate render requests reject stale bounds, false durations and known source gaps before creating a cut',async t=>{
  const base=await fixture(t);
  for(const candidate of [{startTime:-1,endTime:29,duration:30},{startTime:100,endTime:130,duration:30},
    {startTime:0,endTime:30,duration:90},{startTime:100,endTime:120,duration:20},{startTime:NaN,endTime:30,duration:30}]){
    await replaceProjectFile(id,{...base,analysis:{candidates:[{id:'candidate-0001',...candidate}]}});
    await assert.rejects(createClipFromCandidate(id,'candidate-0001'),/intervalo/i);assert.equal((await loadProjectFile(id)).clips.length,0);
  }
  await replaceProjectFile(id,{...base,source:{...base.source,capture:{continuityIntervals:[{start:20,end:22}]}},analysis:{candidates:[{id:'candidate-0001',startTime:0,endTime:30,duration:30}]}});
  await assert.rejects(createClipFromCandidate(id,'candidate-0001'),/interrupción/);assert.equal((await loadProjectFile(id)).clips.length,0);
});
test('an unsupported explicit quality or framing choice is rejected rather than silently replaced',async t=>{
  const base=await fixture(t);await replaceProjectFile(id,base);
  for(const input of [{quality:'ULTRA_UNKNOWN'},{framingMode:'TRACK_PERSON'}])await assert.rejects(createManualClip(id,{startTime:0,endTime:30,rightsConfirmed:true,...input}),/inválid|válid/);
  assert.equal((await loadProjectFile(id)).clips.length,0);
});
test('a legacy saved cut with inconsistent bounds fails visibly before it opens a source or starts encoding',async t=>{
  const base=await fixture(t),clipId='55d38c52-0292-48b8-b3a2-f44e934ac772';
  await replaceProjectFile(id,{...base,clips:[{id:clipId,status:'QUEUED',startTime:0,endTime:30,duration:90,edit:{quality:'EFFICIENT'}}]});
  await assert.rejects(renderClip(id,clipId),{code:'CLIP_SOURCE_INVALID'});
  const clip=(await loadProjectFile(id)).clips[0];assert.equal(clip.status,'FAILED');assert.match(clip.error,/intervalo/);
});
