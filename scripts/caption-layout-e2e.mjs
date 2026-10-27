// A new interval of an authorized source, cached real ASR and the existing
// CONVERSATION renderer. No synthetic scenes, voices, new ASR or AI calls.
import assert from 'node:assert/strict';
import path from 'node:path';import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,link,readdir,rename,access} from 'node:fs/promises';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {replaceProjectFile,loadProjectFile,updateProjectFile} from '../lib/project-files.mjs';
import {createManualClip,renderClip} from '../services/clip/ClipService.mjs';
import {prepareSubtitleTrack,updateSubtitleTrack,buildSrtDocument} from '../services/subtitles/SubtitleService.mjs';
import {applySpeechFocus} from '../services/reframe/AutoReframeService.mjs';
import {runMedia} from '../services/media-processing/MediaValidationService.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
if(!process.argv.includes('--rights-confirmed')||!process.env.CLIPFORGE_NATIVE_EN_PROJECT)throw new Error('Provide a real English project and --rights-confirmed.');
const file=process.env.CLIPFORGE_NATIVE_EN_PROJECT,original=JSON.parse(await readFile(file,'utf8'));
assert.equal(original.transcript.language,'en');assert.equal(original.transcript.status,'COMPLETED');
const source=path.resolve(path.dirname(file),'..',original.source.relativePath),sourceHash=await hashFile(source);
if(process.env.CLIPFORGE_TEST_SOURCE_SHA256)assert.equal(sourceHash,process.env.CLIPFORGE_TEST_SOURCE_SHA256);
const parent=path.resolve('artifacts/completion-20261027');await mkdir(parent,{recursive:true});
const resume=process.argv.find(a=>a.startsWith('--resume-run='))?.slice(13),run=resume?path.resolve(resume):await mkdtemp(path.join(parent,'layout-'));
if(!run.startsWith(parent+path.sep))throw new Error('Unexpected acceptance root.');
const root=path.join(run,'storage');let id,clip;
if(resume){const files=(await readdir(path.join(root,'projects'))).filter(name=>name.endsWith('.json'));assert.equal(files.length,1);const saved=JSON.parse(await readFile(path.join(root,'projects',files[0]),'utf8'));id=saved.id;clip=saved.clips[0];
  const partial=path.join(root,'clips',id,clip.id,'render.partial.mp4');try{await access(partial);await rename(partial,partial+'.rejected-resolution-'+Date.now());}catch(error){if(error.code!=='ENOENT')throw error;}
} else {id=randomUUID();
const relativePath=`uploads/${id}/source.mp4`;await mkdir(path.join(root,'uploads',id),{recursive:true});await link(source,path.join(root,relativePath));
process.env.CLIPFORGE_STORAGE_DIR=root;process.env.CLIPFORGE_RENDER_THREADS='1';
await replaceProjectFile(id,{id,createdAt:new Date().toISOString(),source:{...original.source,projectId:id,relativePath},transcript:{...original.transcript,projectId:id,reusedForIdenticalBytesSha256:sourceHash},clips:[]});
({clip}=await createManualClip(id,{startTime:79.28,endTime:95.28,rightsConfirmed:true,subtitleMode:'ORIGINAL_EN',aspectRatio:'16:9',resolution:'720p',quality:'EFFICIENT',framingMode:'CONVERSATION'}));
let project=await loadProjectFile(id);const track=await prepareSubtitleTrack(project,clip);await updateProjectFile(id,p=>{p.clips[0].subtitles=track;});
await updateSubtitleTrack(id,clip.id,{layout:{fontSize:60,position:'TOP',marginPercent:8,color:'#FFE55B'}});
await applySpeechFocus(id,clip.id);}
process.env.CLIPFORGE_STORAGE_DIR=root;const started=Date.now(),result=await renderClip(id,clip.id),renderSeconds=(Date.now()-started)/1000;
assert.equal(result.clip.render.width,1280);assert.equal(result.clip.render.height,720);assert.equal(result.clip.render.subtitlesBurned,true);assert.equal(result.clip.render.autoReframeApplied,true);
assert.equal(await hashFile(source),sourceHash);assert.equal(result.clip.autoReframe.speakerAware,false);
await writeFile(path.join(run,'original-en.srt'),buildSrtDocument(result.clip.subtitles));
const mp4=path.join(root,result.clip.render.relativePath);for(const t of [2,10])await runMedia(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-y','-ss',String(t),'-i',mp4,'-frames:v','1',path.join(run,`frame-${t}.png`)]);
const evidence={checkedAt:new Date().toISOString(),passed:true,run,nodeVersion:process.version,sourceSha256:sourceHash,sourceOffset:Number(process.env.CLIPFORGE_TEST_SOURCE_OFFSET||0),startTime:79.28,endTime:95.28,sourceAsrReused:true,sourceAsrModel:original.transcript.model,
  externalAiCalls:0,synthetic:false,publicDeployment:false,physicalAndroid:false,editorialApproval:'PENDING',renderSeconds,sha256:await hashFile(mp4),render:result.clip.render,layout:result.clip.subtitles.layout,reframeBasis:'SPEECH_ACTIVITY_NOT_PERSON_TRACKING'};
if(process.env.CLIPFORGE_RUN_R2_TESTS==='true'){
  const library=new ClipLibraryService(),saved=await library.archive(await loadProjectFile(id),result.clip,{root});await library.setKeep(saved.id,true);
  const download=await library.source(saved.id);const {createHash}=await import('node:crypto');const hash=createHash('sha256');for await(const chunk of download.body)hash.update(chunk);assert.equal(hash.digest('hex'),evidence.sha256);
  const recovery=new ProjectRecoveryService({root});await recovery.backup(id);await recovery.restore(id,{targetRoot:path.join(run,'restored')});
  assert.equal(await hashFile(path.join(run,'restored',result.clip.render.relativePath)),evidence.sha256);evidence.r2={archiveId:saved.id,downloadHashMatched:true,restoredHashMatched:true};
}
await writeFile(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,run,sha256:evidence.sha256,renderSeconds}));
