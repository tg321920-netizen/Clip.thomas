// Recover a bounded authorized window through ClipForge's existing ingest and
// transcription services. No synthetic speech/images and no publishing.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {IngestJobStore} from '../services/ingest/IngestJobStore.mjs';
import {ingestUrlJob} from '../services/ingest/UrlIngestService.mjs';
import {transcribeProject} from '../services/transcription/TranscriptionService.mjs';
import {loadProjectFile} from '../lib/project-files.mjs';
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
if(process.env.CLIPFORGE_RUN_EXTERNAL_MEDIA_TESTS!=='true'||!process.argv.includes('--rights-confirmed'))throw new Error('Captura externa autorizada requerida.');
const start=Number(arg('start')),seconds=Number(arg('seconds')||120);
if(!Number.isFinite(start)||!Number.isFinite(seconds)||start<0||start>10200||seconds<45||seconds>180)throw new Error('Ventana acotada no válida.');
const url='https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6';
const store=new IngestJobStore(),job=await store.create({url,mode:'STREAM',startTimeSeconds:start,captureSeconds:seconds,segmentSeconds:60,autoClip:false,subtitles:false,captureChat:false});
const folder=path.resolve('artifacts/real-westcol/windows');await mkdir(folder,{recursive:true});
await writeFile(path.join(folder,`${job.id}.json`),JSON.stringify({projectId:job.id,sourceUrl:url,requestedStart:start,requestedSeconds:seconds},null,2));
let owned=null,heartbeat=null,captured=false;
try{
 owned=await store.claimNext(['INGEST_URL'],job.id);if(!owned)throw Object.assign(new Error('Otro worker ya tiene este trabajo; no se abre un segundo capturador.'),{code:'INGEST_BUSY'});
 heartbeat=setInterval(()=>void store.heartbeat(job.id).catch(()=>{}),15000);heartbeat.unref();
 const result=await ingestUrlJob(owned,{onProgress:(p,s)=>store.updateProgress(job.id,p,s)});await store.complete(owned,result);captured=true;clearInterval(heartbeat);
 console.log(JSON.stringify({stage:'REAL_SOURCE_SAVED',projectId:job.id,start,seconds:result.video.durationSeconds}));
 await transcribeProject(job.id);const project=await loadProjectFile(job.id);console.log(JSON.stringify({stage:'REAL_TRANSCRIPT_READY',projectId:job.id,provider:project.transcript.provider,model:project.transcript.model,language:project.transcript.language,segments:project.transcript.segments.length}));
}catch(error){if(owned&&!captured)await store.fail(owned,error,{retryable:false});console.warn(JSON.stringify({projectId:job.id,capturePreserved:captured,code:error.code||'REAL_WINDOW_FAILED',message:error.message}));process.exitCode=1;}
finally{if(heartbeat)clearInterval(heartbeat);}
