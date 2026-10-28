import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {replaceProjectFile,loadProjectFile} from '../lib/project-files.mjs';
import {createManualClip} from '../services/clip/ClipService.mjs';
import {JobStore} from '../services/JobStore.mjs';

test('missing translation resources pause one job before ASR without blocking manual clipping',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-translation-resource-')),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  const id='8e56073f-ae3a-4c2c-a73d-b11085dbd1b6';await replaceProjectFile(id,{id,source:{durationSeconds:60,hasAudio:true,relativePath:`uploads/${id}/source.mp4`},clips:[]});
  const {clip}=await createManualClip(id,{startTime:0,endTime:30,subtitleMode:'TRANSLATE_ES',rightsConfirmed:true});const store=new JobStore();const queued=await store.enqueueRender(id,clip.id);
  await promisify(execFile)(process.execPath,['scripts/render-worker.mjs','--once'],{env:{...process.env,CLIPFORGE_STORAGE_DIR:root,CLIPFORGE_TRANSLATION_PYTHON:'',CLIPFORGE_TRANSLATION_MODEL_PATH:'',WHISPER_CPP_COMMAND:'/not-installed-for-this-resource-test'},timeout:10000});
  const job=await store.get(queued.id),project=await loadProjectFile(id);assert.equal(job.status,'WAITING_RESOURCE');assert.equal(job.attempts,1);assert.equal(project.transcript,undefined);assert.match(job.error,/no está configurada/);
  const manual=await createManualClip(id,{startTime:0,endTime:30,subtitleMode:'NONE',rightsConfirmed:true});assert.notEqual(manual.clip.id,clip.id);assert.equal(manual.clip.edit.subtitlesEnabled,false);
});

test('a definitive caption-language mismatch fails once and leaves the cut editable instead of retrying unchanged input',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cf-language-input-')),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  const id='8e56073f-ae3a-4c2c-a73d-b11085dbd1b6';
  await replaceProjectFile(id,{id,source:{durationSeconds:60,relativePath:`uploads/${id}/source.mp4`},
    transcript:{id:'explicit-language-fixture',status:'COMPLETED',language:'en',segments:[{startTime:0,endTime:30,text:'Explicit metadata-only unit fixture.'}]},clips:[]});
  const {clip}=await createManualClip(id,{startTime:0,endTime:30,rightsConfirmed:true,subtitleMode:'ORIGINAL_ES'}),store=new JobStore(),job=await store.enqueueRender(id,clip.id);
  await promisify(execFile)(process.execPath,['scripts/render-worker.mjs','--once'],{env:{...process.env,CLIPFORGE_STORAGE_DIR:root},timeout:10000});
  const failed=await store.get(job.id);assert.equal(failed.status,'FAILED');assert.equal(failed.attempts,1);assert.match(failed.error,/audio detectado no es español/);
  assert.equal((await loadProjectFile(id)).clips[0].status,'FAILED');
});
