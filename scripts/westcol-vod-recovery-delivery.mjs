// Bounded acceptance of an already rendered real Westcol clip. No captures,
// model calls, re-encoding, social publication or public bucket changes.
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';
import {mkdir,mkdtemp,readFile,writeFile,rename,readdir,link,stat} from 'node:fs/promises';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {loadProjectFile} from '../lib/project-files.mjs';
import {getStorageRoot,resolveStoragePath} from '../lib/storage-paths.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {LiveArchiveService} from '../services/live/LiveArchiveService.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
import {EditorialEventStore} from '../services/analysis/EditorialEventStore.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {inspectLiveSegment} from '../services/live/LiveWindowService.mjs';

if(process.env.CLIPFORGE_RUN_R2_TESTS!=='true'||!process.argv.includes('--rights-confirmed'))throw new Error('Private R2 acceptance requires explicit rights and R2 opt-in.');
const output=path.resolve('artifacts/westcol-capture-recheck-20261027');await mkdir(output,{recursive:true});
const plan=JSON.parse(await readFile(path.join(output,'fresh-clip-selection.json'),'utf8'));
const proof=JSON.parse(await readFile(path.join(output,'fresh-source-evidence.json'),'utf8'));
const project=await loadProjectFile(plan.projectId),clip=project?.clips?.find(c=>c.id===plan.clipId);
assert.ok(project&&!project.testOnly&&clip?.status==='READY');assert.equal(clip.editorialReview.status,'PENDING');
assert.match(project.source.originUrl,/^https:\/\/kick\.com\/westcol\/videos\/[a-f0-9-]{36}$/u);
assert.equal(project.source.originUrl,proof.sourceUrl);assert.equal(project.liveObservation.source.sourceKind,'VOD');
assert.equal(await hashFile(resolveStoragePath(project.source.relativePath)),proof.sourceSha256);
const evidence={checkedAt:new Date().toISOString(),sourceUrl:proof.sourceUrl,sourceId:plan.sourceId,sourceKind:'VOD',liveCapture:false,
  projectId:project.id,clipId:clip.id,sourceSha256:proof.sourceSha256,chatObserved:false,realLlmCalls:0,newClipCount:1,
  editorialReview:'PENDING',modelApproved:false,ownerApproved:false,publicDeployment:false,physicalAndroid:false,rawTsArchivedByThisTest:false};
try {
  const events=new EditorialEventStore();await events.confirm(project.liveObservation.source,clip.candidateId,project.id);
  const original=new LiveArchiveService();await original.sessions.create(project.id,project.liveObservation.source);
  const inputParts=path.join(path.dirname(resolveStoragePath(project.source.relativePath)),'.stream-parts');
  const retainedParts=path.join(getStorageRoot(),'live-sessions',project.id,'capture','.stream-parts');await mkdir(retainedParts,{recursive:true});
  const names=(await readdir(inputParts)).filter(name=>/^part-\d{6}\.ts$/u.test(name)).sort();assert.ok(names.length);
  const segments=[];let offset=0;const range=project.source.capture.sourceRanges[0];
  for(const name of names){
    const source=path.join(inputParts,name),file=path.join(retainedParts,name),sha256=await hashFile(source);
    try{await link(source,file);}catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await hashFile(file),sha256);}
    const validation=await inspectLiveSegment(file),index=Number(/part-(\d+)\.ts$/u.exec(name)[1]);
    const sourceStartUtc=range?.sourceStartUtc?new Date(Date.parse(range.sourceStartUtc)+(offset-range.offsetSeconds)*1000).toISOString():null;
    await original.sessions.addSegment(project.id,{index,relativePath:path.relative(getStorageRoot(),file).split(path.sep).join('/'),durationSeconds:validation.durationSeconds,
      offsetSeconds:offset,sourceStartUtc,sha256,sizeBytes:(await stat(file)).size,closedAt:new Date().toISOString()});
    await original.sessions.validateSegment(project.id,index,validation);await original.archiveSegment(project.id,index);
    segments.push({index,sha256,durationSeconds:validation.durationSeconds,sourceStartUtc});offset+=validation.durationSeconds;
  }
  const archived=await original.archiveOriginalProject(project,project.liveObservation.source,{validatedSource:{sha256:proof.sourceSha256,validation:proof.validation}});
  evidence.rawTsArchivedByThisTest=true;evidence.archivedSegments=segments;
  const saved=archived.outputs.find(o=>o.clipId===clip.id);assert.ok(saved?.id);
  const library=new ClipLibraryService();await library.setKeep(saved.id,true);
  evidence.r2ArchiveId=saved.id;evidence.sourceOriginalArchived=true;evidence.liveCheckpointCreated=true;
  const remote=await library.source(saved.id),sha=createHash('sha256');const file=path.join(output,'new-westcol-r2.mp4'),temporary=file+'.partial';
  await pipeline(Readable.from(remote.body),new Transform({transform(chunk,_encoding,next){sha.update(chunk);next(null,chunk);}}),createWriteStream(temporary,{flags:'wx'}));
  evidence.sha256=sha.digest('hex');assert.equal(evidence.sha256,clip.render.sha256);await rename(temporary,file);
  evidence.validation=await validateMp4(file,{requireAudio:true,duration:clip.duration,width:1080,height:1920});evidence.downloadHashMatched=true;
  const recovery=new ProjectRecoveryService({root:getStorageRoot()});const receipt=await recovery.backup(project.id);
  const target=path.join(await mkdtemp(path.join(output,'restored-project-')),'storage');await original.restore(project.id,{targetRoot:target,workersPaused:true});
  assert.equal(await hashFile(path.join(target,project.source.relativePath)),proof.sourceSha256);
  assert.equal(await hashFile(path.join(target,clip.render.relativePath)),evidence.sha256);
  for(const segment of segments){const file=path.join(target,'live-sessions',project.id,'capture','.stream-parts',`part-${String(segment.index).padStart(6,'0')}.ts`);assert.equal(await hashFile(file),segment.sha256);assert.equal((await inspectLiveSegment(file)).valid,true);}
  evidence.allRawSegmentsRestored=true;
  evidence.projectCheckpoint=receipt;evidence.restoredTo=target;evidence.sourceAndClipRestoredWithIdenticalHashes=true;
  evidence.duration=clip.duration;evidence.startTime=clip.startTime;evidence.endTime=clip.endTime;
  evidence.sourceStartSeconds=project.source.capture.vodStartSeconds+clip.startTime;evidence.sourceEndSeconds=project.source.capture.vodStartSeconds+clip.endTime;
  evidence.selection=plan;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.code=error.code||'REAL_VOD_DELIVERY_FAILED';evidence.diagnostic=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu,'[URL_REDACTED]').slice(0,300);process.exitCode=1;}
await writeFile(path.join(output,'fresh-delivery-evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({passed:evidence.passed,code:evidence.code,archiveId:evidence.r2ArchiveId,sha256:evidence.sha256,duration:evidence.duration,newClips:evidence.newClipCount,review:evidence.editorialReview}));
