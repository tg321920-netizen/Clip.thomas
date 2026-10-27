// Reuse an actual uploaded podcast and its measured ASR. Run the real media
// worker; keep heuristics, R2 and recovery separate from model approval.
import assert from 'node:assert/strict';import path from 'node:path';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';import {randomUUID,createHash} from 'node:crypto';
import {JobStore} from '../services/JobStore.mjs';import {loadProjectFile} from '../lib/project-files.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
import {EditorialEventStore} from '../services/analysis/EditorialEventStore.mjs';import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {analyzeProject} from '../services/analysis/ContentAnalysisService.mjs';
import {requestSubtitleMode} from '../services/subtitles/SubtitleService.mjs';
import {renderClip} from '../services/clip/ClipService.mjs';
if(!process.argv.includes('--rights-confirmed')||!process.env.CLIPFORGE_AUDIO_ACCEPTANCE_RUN)throw new Error('Use an authorized completed audio acceptance run.');
const run=path.resolve(process.env.CLIPFORGE_AUDIO_ACCEPTANCE_RUN);if(!run.startsWith(path.resolve('artifacts/completion-20261027')+path.sep))throw new Error('Unexpected acceptance root.');
const checkpoint=JSON.parse(await readFile(path.join(run,'checkpoint.json'),'utf8')),root=path.join(run,'storage');process.env.CLIPFORGE_STORAGE_DIR=root;
const original=await loadProjectFile(checkpoint.projectId);assert.equal(original.source.mediaKind,'AUDIO');assert.equal(original.transcript.status,'COMPLETED');
if(!checkpoint.autoProjectId){checkpoint.autoProjectId=randomUUID();await writeFile(path.join(run,'checkpoint.json'),JSON.stringify(checkpoint));}
const jobs=new JobStore(),job=await jobs.enqueueMedia('MEDIA_CLIPS',checkpoint.autoProjectId,{projectId:original.id,count:2,minDuration:15,maxDuration:35,targetDuration:25,contentProfile:'PODCAST',analysisProvider:'heuristic',subtitleMode:'ORIGINAL_EN',framingMode:'FIT'});
const started=Date.now();if(job.status!=='READY'){
  const worker=spawn(process.execPath,['scripts/media-worker.mjs','--once'],{env:{...process.env,CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_ANALYSIS_PROVIDER:'heuristic',CLIPFORGE_RENDER_THREADS:'1',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',CLIPFORGE_AGENT_ENABLED:'false'},stdio:['ignore','ignore','ignore']});
  const [code]=await once(worker,'exit');assert.equal(code,0);
}
const completed=await jobs.get(job.id);assert.equal(completed.status,'READY',`Automatic audio pipeline ended ${completed.status}`);
let project=await loadProjectFile(checkpoint.autoProjectId);assert.ok(project.clips.length>0&&project.clips.length<=2);
const qaReview=process.argv.includes('--review-source-boundary');
if(qaReview){
  assert.equal(await hashFile(path.join(root,project.source.relativePath)),'26f217e06013258df315d805bd127bc5436bc10e613232d7e6658706e9074619','This QA review is specific to the measured NASA source, not arbitrary owner clips.');
  const raw=await readFile(path.join(run,'automatic-evidence.json'),'utf8');try{await writeFile(path.join(run,'automatic-evidence-before-review.json'),raw,{flag:'wx'});}catch(error){if(error.code!=='EEXIST')throw error;}
  const before=JSON.parse(await readFile(path.join(run,'automatic-evidence-before-review.json'),'utf8')),bad=project.clips.find(c=>c.startTime===0),good=project.clips.find(c=>c.startTime>0);assert.ok(bad&&good);
  const record=before.clips.find(c=>c.clipId===bad.id);assert.ok(record?.archiveId);const library=new ClipLibraryService();const identity=await library.identity(record.archiveId);assert.equal(identity.projectId,project.id);
  await library.setReview(record.archiveId,'REJECTED');
  const unchangedSha=await hashFile(path.join(root,good.render.relativePath));await requestSubtitleMode(project.id,good.id,'ORIGINAL_EN');const corrected=await renderClip(project.id,good.id);assert.equal(corrected.reused,true);assert.equal(await hashFile(path.join(root,good.render.relativePath)),unchangedSha);assert.ok(corrected.clip.subtitles.cues.every(c=>!/applause/iu.test(c.text)));
  const analysis=await analyzeProject(original.id,{minDuration:15,maxDuration:35,targetDuration:25,maxCandidates:5,requireCompleteSentences:true,measureMediaEvidence:true,contentProfile:'PODCAST'});
  assert.ok(analysis.analysis.candidates.every(c=>c.startTime>0));await writeFile(path.join(run,'boundary-analysis-v6.json'),JSON.stringify({actualAudioEvidence:true,audioEvidenceReused:analysis.reused,newAsr:false,newRenders:0,analysis:analysis.analysis},null,2));
  project=await loadProjectFile(project.id);await new ProjectRecoveryService({root}).backup(project.id);
}
const active=project.clips.filter(c=>c.editorialReview?.status!=='REJECTED');
const evidence={checkedAt:new Date().toISOString(),passed:true,synthetic:false,externalAiCalls:0,sourceAsrReused:true,publicDeployment:false,physicalAndroid:false,
  requestedCount:2,generatedBeforeEditorialReview:project.clips.length,actualCount:active.length,qaReviewBy:qaReview?'CODEX_QA_NOT_OWNER_APPROVAL':null,sourceSha256:await hashFile(path.join(root,project.source.relativePath)),elapsedSeconds:(Date.now()-started)/1000,clips:[]};
for(const clip of active){assert.equal(clip.render.mediaKind,'AUDIO');assert.equal(clip.subtitles.language,'en');assert.equal(clip.editorialReview.status,'PENDING');assert.ok(clip.render.validation.fullDecode);
  const item={clipId:clip.id,startTime:clip.startTime,endTime:clip.endTime,sha256:await hashFile(path.join(root,clip.render.relativePath)),method:'LOCAL_HEURISTIC',review:'PENDING',validation:clip.render.validation};
  if(process.env.CLIPFORGE_RUN_R2_TESTS==='true'){const library=new ClipLibraryService(),saved=await library.archive(project,clip,{root});await library.setKeep(saved.id,true);const remote=await library.source(saved.id),hash=createHash('sha256');for await(const chunk of remote.body)hash.update(chunk);assert.equal(hash.digest('hex'),item.sha256);item.archiveId=saved.id;}
  evidence.clips.push(item);
}
if(process.env.CLIPFORGE_RUN_R2_TESTS==='true'){const recovery=new ProjectRecoveryService({root}),target=await mkdtemp(path.join(run,'automatic-restored-'));await recovery.backup(project.id);await recovery.restore(project.id,{targetRoot:target});
  const restored=JSON.parse(await readFile(path.join(target,'projects',project.id+'.json'),'utf8')),events=new EditorialEventStore({root:target});const source={channelId:'FILE',sourceId:evidence.sourceSha256,sourceKind:'FILE'};
  await events.recoverFileProjects(source,[restored]);assert.equal(await events.reserve(source,{...restored.analysis.candidates[0],id:'new-job-candidate'},randomUUID()),false);evidence.r2RecoveryAndDeduplication=true;
}
await writeFile(path.join(run,'automatic-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({passed:true,run,clips:active.length,elapsedSeconds:evidence.elapsedSeconds}));
