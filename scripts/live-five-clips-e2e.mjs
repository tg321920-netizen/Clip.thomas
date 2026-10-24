// Own recorded source through real segmented capture and the media worker.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { captureSegmentedStream, queueCapturedBatch } from '../services/ingest/UrlIngestService.mjs';
import { IngestJobStore } from '../services/ingest/IngestJobStore.mjs';
import { JobStore } from '../services/JobStore.mjs';
import { replaceProjectFile } from '../lib/project-files.mjs';
import { probeMediaFile, validateMp4 } from '../services/media-processing/MediaValidationService.mjs';
const output = path.resolve('artifacts/live-five-clips');
await mkdir(output,{recursive:true});
const manifestPath = path.join(output,'run.json');
let storage, job;
if (process.argv.includes('--resume')) {
  const saved = JSON.parse(await readFile(manifestPath,'utf8'));
  storage = saved.storage;
  process.env.CLIPFORGE_STORAGE_DIR = storage;
  const previous = await new JobStore().get(saved.jobId);
  if (!previous) throw new Error('No saved five-clip job exists');
  job = previous.status === 'FAILED' || previous.status === 'WAITING_RESOURCE'
    ? await new JobStore().enqueueMedia(previous.type, previous.projectId, previous.payload) : previous;
} else {
  const fixture = path.resolve('artifacts/live-clipping');
  const existing = JSON.parse(await readFile(path.join(fixture,'evidence.json'),'utf8'));
  const origin = JSON.parse(await readFile(path.join(fixture,'storage/projects',`${existing.result.projectId}.json`),'utf8'));
  const input = path.join(fixture,'storage/uploads',origin.clipsOrigin.projectId,'source.mp4');
  storage = path.join(output, randomUUID());
  process.env.CLIPFORGE_STORAGE_DIR = storage;
  const ingest = await new IngestJobStore().create({ url:'https://example.invalid/authorized-fixture', mode:'STREAM', autoClip:true, clipMode:'CAPTURE', clipCount:5, clipDuration:30, contentProfile:'PODCAST' });
  const projectId = ingest.projectId;
  const directory = path.join(storage,'uploads',projectId);
  await mkdir(directory,{recursive:true});
  const source = await captureSegmentedStream({ url:input, uploadDir:directory, captureSeconds:180, segmentSeconds:60 });
  const media = await probeMediaFile(source);
  await replaceProjectFile(projectId,{ id:projectId, createdAt:new Date().toISOString(), source:{ projectId, originalName:'own-authorized-capture.mp4', relativePath:`uploads/${projectId}/source.mp4`, durationSeconds:media.duration, width:media.video.width, height:media.video.height, hasAudio:Boolean(media.audio) }, clips:[] });
  job = await queueCapturedBatch({ projectId, job:ingest });
  await writeFile(manifestPath,JSON.stringify({storage,jobId:job.id}));
}
process.env.CLIPFORGE_AGENT_REAL_PUBLISHING = 'false';
process.env.CLIPFORGE_CONTENT_REAL_PUBLISHING = 'false';
process.env.CLIPFORGE_SMART_PUBLISH_ON_BOOT = 'false';
process.env.WHISPER_LANGUAGE = 'en';
await new Promise((resolve,reject)=>{
  const worker=spawn(process.execPath,['scripts/media-worker.mjs','--once'],{env:process.env,stdio:'inherit'});
  worker.on('error',reject);
  worker.on('exit',code=>code===0?resolve():reject(new Error(`Worker exit ${code}`)));
});
const completed=await new JobStore().get(job.id);
assert.equal(completed.status,'READY',completed.error || 'Five-clip batch not ready');
assert.equal(completed.result.clips.length,5);
for(const clip of completed.result.clips) await validateMp4(path.join(storage,clip.relativePath),{width:1080,height:1920,duration:clip.duration,requireAudio:true});
for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)assert.ok(Math.min(completed.result.clips[i].endTime,completed.result.clips[j].endTime)<=Math.max(completed.result.clips[i].startTime,completed.result.clips[j].startTime));
await writeFile(path.join(output,'evidence.json'),JSON.stringify({passed:true,fixture:'Own recorded source through segmented capture; no platform request',requested:5,actual:completed.result.clips.length,storage,job:completed,publication:'OFF'},null,2));
console.log('Five distinct real live-capture clips PASSED');
