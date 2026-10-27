// Real, previously authorized streaming source. Verify cancellation/recovery
// without redownloading, re-encoding, changing the source, or claiming live.
import assert from 'node:assert/strict';
import path from 'node:path';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {mkdir, mkdtemp, readdir, readFile, writeFile, link} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {captureSegmentedStream} from '../services/ingest/UrlIngestService.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {getStorageRoot, resolveStoragePath} from '../lib/storage-paths.mjs';
import {isProjectId} from '../lib/project-id.mjs';
import {probeMediaFile} from '../services/media-processing/MediaValidationService.mjs';

const arg=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const id=arg('source-project'),expected=arg('source-sha256');
if(!process.argv.includes('--rights-confirmed')||!isProjectId(id)||!/^[a-f0-9]{64}$/u.test(expected||'')||process.platform!=='linux') {
  throw new Error('Use an authorized preserved source: --rights-confirmed --source-project=UUID --source-sha256=HASH on Linux.');
}
const project=JSON.parse(await readFile(path.join(getStorageRoot(),'projects',`${id}.json`),'utf8'));
assert.equal(project.id,id);assert.equal(await hashFile(resolveStoragePath(project.source.relativePath)),expected);
const original=path.join(path.dirname(resolveStoragePath(project.source.relativePath)),'.stream-parts');
const names=(await readdir(original)).filter(name=>/^part-\d{6}\.ts$/u.test(name)).sort();assert.ok(names.length);
const output=path.resolve('artifacts/westcol-capture-recheck-20261027');await mkdir(output,{recursive:true});
const run=await mkdtemp(path.join(output,'native-recovery-')),capture=path.join(run,'capture'),parts=path.join(capture,'.stream-parts');await mkdir(parts,{recursive:true});
const hashes={};for(const name of names){hashes[name]=await hashFile(path.join(original,name));await link(path.join(original,name),path.join(parts,name));}
const common={url:'https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6',uploadDir:capture,captureSeconds:Math.max(5,Math.floor(project.source.durationSeconds)),finalize:false,
  hlsInputFactory:()=>{throw new Error('Completed preserved media must not request upstream playback.');}};
const controller=new AbortController(),exec=promisify(execFile);
const work=captureSegmentedStream({...common,signal:controller.signal});work.catch(()=>{});
let cancelled=false;
try {
  for(let i=0;i<250;i++){
    const children=await exec('ps',['-o','comm=','--ppid',String(process.pid)]).catch(()=>({stdout:''}));
    if(children.stdout.split('\n').some(name=>name.trim()==='ffmpeg')){controller.abort();cancelled=true;break;}
    await delay(10);
  }
  assert.equal(cancelled,true,'Could not observe a real decoder; no successful interruption claimed.');
  await assert.rejects(work,error=>error.name==='AbortError');
} finally {controller.abort();await work.catch(()=>{});}
assert.deepEqual((await readdir(parts)).filter(name=>name.endsWith('.ts')).sort(),names);
assert.ok(!(await readdir(parts)).some(name=>name.includes('.invalid-')));
const verified=[];const result=await captureSegmentedStream({...common,onSegment:async(file,index,context)=>{
  const technical=await probeMediaFile(file);assert.ok(technical.video&&technical.audio,'Each verified streaming segment must contain both original tracks.');
  verified.push({index,sha256:await hashFile(file),...context,videoCodec:technical.video.codec_name,audioCodec:technical.audio.codec_name,width:technical.video.width,height:technical.video.height});
}});
assert.equal(result.parts.length,names.length);assert.equal(verified.length,names.length);
for(const name of names){assert.equal(await hashFile(path.join(parts,name)),hashes[name]);assert.equal(await hashFile(path.join(original,name)),hashes[name]);}
const evidence={checkedAt:new Date().toISOString(),passed:true,nodeVersion:process.version,sourceProjectId:id,sourceSha256:expected,
  previouslyCapturedAuthorizedVod:true,newLiveCapture:false,newMp4Clips:0,newEncodes:0,upstreamRequests:0,apiMocks:false,physicalAndroid:false,
  cancelledDuringRealDecode:cancelled,recoveryDecodedAllSegments:true,originalsUnchanged:true,verifiedSegments:verified,
  clockEvidence:verified.every(part=>part.sourceStartUtc)?'PRESERVED':'NOT_AVAILABLE_IN_THIS_LEGACY_SOURCE',run};
await writeFile(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
