// Actual English/Spanish sources with previously measured, hash-bound Whisper ASR.
// No new ASR, translation call, synthetic video, R2 write or publishing.
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,link,writeFile} from 'node:fs/promises';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {replaceProjectFile,loadProjectFile} from '../lib/project-files.mjs';
import {createManualClip,renderClip} from '../services/clip/ClipService.mjs';
import {buildSrtDocument} from '../services/subtitles/SubtitleService.mjs';

if(!process.argv.includes('--rights-confirmed')||!process.env.CLIPFORGE_NATIVE_EN_PROJECT||!process.env.CLIPFORGE_NATIVE_ES_PROJECT)throw new Error('Provide both real project JSON paths and --rights-confirmed.');
const output=path.resolve('artifacts/native-subtitles');await mkdir(output,{recursive:true});const run=await mkdtemp(path.join(output,'run-'));const root=path.join(run,'storage');
const cases=[{file:process.env.CLIPFORGE_NATIVE_EN_PROJECT,language:'en',mode:'ORIGINAL_EN',startTime:50.6,endTime:76.1},{file:process.env.CLIPFORGE_NATIVE_ES_PROJECT,language:'es',mode:'ORIGINAL_ES',startTime:117.8,endTime:125.8}];
const results=[];
for(const entry of cases){
  const original=JSON.parse(await readFile(entry.file,'utf8'));assert.equal(original.transcript.status,'COMPLETED');assert.equal(original.transcript.language,entry.language);
  const originalRoot=path.resolve(path.dirname(entry.file),'..');const source=path.join(originalRoot,original.source.relativePath);const sourceHash=await hashFile(source);
  const id=randomUUID(),relativePath=`uploads/${id}/source.mp4`;await mkdir(path.join(root,'uploads',id),{recursive:true});await link(source,path.join(root,relativePath));
  process.env.CLIPFORGE_STORAGE_DIR=root;process.env.CLIPFORGE_TRANSLATION_PYTHON='';process.env.WHISPER_CPP_COMMAND='/not-installed-for-cached-native-test';
  await replaceProjectFile(id,{id,createdAt:new Date().toISOString(),source:{...original.source,relativePath,projectId:id},transcript:{...original.transcript,projectId:id,reusedForIdenticalSource:true,derivedFromSourceSha256:sourceHash},clips:[],qaOnly:true});
  const {clip}=await createManualClip(id,{startTime:entry.startTime,endTime:entry.endTime,framingMode:'FIT',quality:'EFFICIENT',resolution:'720p',aspectRatio:'9:16',subtitleMode:entry.mode,rightsConfirmed:true});
  const result=await renderClip(id,clip.id);assert.equal(result.clip.status,'READY');assert.equal(result.clip.render.subtitlesBurned,true);assert.equal(result.clip.subtitles.language,entry.language);
  assert.equal(result.clip.subtitles.translation,undefined);assert.equal(await hashFile(source),sourceHash);
  const srt=path.join(run,entry.language+'.srt');await writeFile(srt,buildSrtDocument(result.clip.subtitles));
  const project=await loadProjectFile(id);assert.equal(project.clips.length,1);assert.equal(project.transcript.derivedFromSourceSha256,sourceHash);
  results.push({mode:entry.mode,language:entry.language,sourceSha256:sourceHash,transcriptReusedForIdenticalBytes:true,transcriptModel:project.transcript.model,startTime:entry.startTime,endTime:entry.endTime,file:path.join(root,result.clip.render.relativePath),srt,render:result.clip.render,cues:result.clip.subtitles.cues,editorialApproval:'PENDING',technicalQaOnly:entry.language==='es'});
}
await writeFile(path.join(run,'evidence.json'),JSON.stringify({passed:true,synthetic:false,publicDeployment:false,physicalAndroid:false,externalAiCalls:0,newTranscriptions:0,newR2Media:0,results},null,2));console.log(JSON.stringify({passed:true,run,modes:results.map(r=>r.mode),newAsr:false,newTranslation:false}));
