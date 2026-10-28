import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {replaceProjectFile,loadProjectFile} from '../lib/project-files.mjs';
import {markClipQueued} from '../services/clip/ClipService.mjs';
const projectId='8e56073f-ae3a-4c2c-a73d-b11085dbd1b6',clipId='55d38c52-0292-48b8-b3a2-f44e934ac772';
test('a second request cannot replace the active automatic/manual render state or its edits',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cf-queue-owner-')),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  for(const status of ['PROCESSING','RENDERING']){
    const clip={id:clipId,status,edit:{quality:'EFFICIENT',output:{width:1280,height:720}},subtitles:{cues:[{text:'Saved correction.'}]},updatedAt:'unchanged'};
    await replaceProjectFile(projectId,{id:projectId,clips:[clip]});
    await assert.rejects(markClipQueued(projectId,clipId),{code:'CLIP_BUSY'});
    assert.deepEqual((await loadProjectFile(projectId)).clips[0],clip);
  }
});
test('a queued clip without a saved job remains recoverable without changing its ID',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cf-queue-orphan-')),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  await replaceProjectFile(projectId,{id:projectId,clips:[{id:clipId,status:'QUEUED'}]});
  await markClipQueued(projectId,clipId);assert.equal((await loadProjectFile(projectId)).clips[0].id,clipId);
});
