// Resource-limited LOCAL QA only. The source is real; this is not a Render deployment.
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {replaceProjectFile} from '../lib/project-files.mjs';
import {createManualClip,markClipQueued,getClip} from '../services/clip/ClipService.mjs';
import {JobStore} from '../services/JobStore.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {probeMediaFile} from '../services/media-processing/MediaValidationService.mjs';
const id='8e56073f-ae3a-4c2c-a73d-b11085dbd1b6',started=Date.now(),file=`/profile/storage/uploads/${id}/source.mp4`;
if(!process.argv.includes('--rights-confirmed')||!/^[a-f0-9]{64}$/.test(process.env.CLIPFORGE_PROFILE_SOURCE_SHA256||''))throw new Error('Requires --rights-confirmed and CLIPFORGE_PROFILE_SOURCE_SHA256 for a real mounted source.');
let runtime,stage='SOURCE_PROBE',failed=false,activeClipId=null;
const deadlineMs=360000;
const usage=()=>{try{return{memoryPeakBytes:Number(readFileSync('/sys/fs/cgroup/memory.peak','utf8')),memoryMax:readFileSync('/sys/fs/cgroup/memory.max','utf8').trim(),cpuMax:readFileSync('/sys/fs/cgroup/cpu.max','utf8').trim(),memoryEvents:readFileSync('/sys/fs/cgroup/memory.events','utf8').trim(),cpuStat:readFileSync('/sys/fs/cgroup/cpu.stat','utf8').trim()};}catch{return{limitsUnverified:true};}};
const progress=setInterval(async()=>{const clip=activeClipId?await getClip(id,activeClipId):null,job=activeClipId?await new JobStore().getRenderJob(id,activeClipId):null;console.log(JSON.stringify({stage,elapsedSeconds:Math.round((Date.now()-started)/1000),clipStatus:clip?.status||null,renderProgress:job?.progress||0,...usage()}));},15000);progress.unref();
let result={startedAt:new Date().toISOString(),node:process.version,profile:'stable',width:720,height:1280,quality:'EFFICIENT',renderThreads:Number(process.env.CLIPFORGE_RENDER_THREADS||2),r2WorkerUnderTheseLimits:false,externalServer:false,simulatedHostingLimits:true,extraTestOrchestratorIncluded:true};
try{
 const limits=usage(),[quota,period]=String(limits.cpuMax).split(' ').map(Number);
 if(limits.memoryMax!=='536870912'||!Number.isFinite(quota)||!Number.isFinite(period)||quota/period!==0.1)throw new Error('EXPECTED_RESOURCE_LIMITS_NOT_ENFORCED');
 await mkdir('/profile/storage',{recursive:true});const probe=await probeMediaFile(file),sha=await hashFile(file);
 if(sha!==process.env.CLIPFORGE_PROFILE_SOURCE_SHA256)throw new Error('SOURCE_HASH_MISMATCH');
 await replaceProjectFile(id,{id,createdAt:new Date().toISOString(),source:{projectId:id,relativePath:`uploads/${id}/source.mp4`,durationSeconds:probe.duration,hasAudio:!!probe.audio,originalName:'authorized-preserved-source.mp4'},clips:[]});
 process.env.CLIPFORGE_OWNER_ACCESS_KEY=randomBytes(32).toString('hex');process.env.CLIPFORGE_SESSION_KEY=randomBytes(32).toString('hex');
 runtime=spawn(process.execPath,['scripts/render-runtime-free.mjs'],{cwd:'/app',env:process.env,stdio:['ignore','inherit','inherit']});
 stage='BOOT_WEB_AND_WORKERS';let health;
 for(let i=0;i<120;i++){if(runtime.exitCode!==null)throw new Error('RUNTIME_EXITED');try{const r=await fetch('http://127.0.0.1:10000/api/health',{signal:AbortSignal.timeout(5000)});const h=await r.json();if(r.ok&&h.processing?.running){health=h;break;}}catch{}await delay(500);}
 if(!health)throw new Error('BOOT_TIMEOUT');result.health=health;
 const c=await createManualClip(id,{startTime:50,endTime:80,rightsConfirmed:true,framingMode:'FIT',quality:'EFFICIENT',resolution:'720p'});activeClipId=c.clip.id;await markClipQueued(id,c.clip.id);const job=await new JobStore().enqueueRender(id,c.clip.id,{clipId:c.clip.id},{restartCompleted:true});
 stage='RENDER_30_SECONDS';const renderStarted=Date.now();let clip;
 while(Date.now()-renderStarted<deadlineMs){if(runtime.exitCode!==null)throw new Error('RUNTIME_EXITED');clip=await getClip(id,c.clip.id);if(clip?.status==='FAILED')throw new Error('RENDER_FAILED');if(clip?.status==='READY')break;await delay(1000);}
 if(clip?.status!=='READY')throw new Error('RENDER_DEADLINE_360_SECONDS');
 result={...result,passed:true,sourceSha256:sha,jobId:job.id,clipId:clip.id,renderSeconds:(Date.now()-renderStarted)/1000,validation:clip.render.validation,relativePath:clip.render.relativePath,sha256:await hashFile(`/profile/storage/${clip.render.relativePath}`)};
 const check=await fetch(`http://127.0.0.1:10000${clip.render.sourceUrl}`,{signal:AbortSignal.timeout(10000)});result.unauthenticatedMediaStatus=check.status;await check.body?.cancel();
 if(check.status!==401)throw new Error('OWNER_AUTH_CHECK_FAILED');
}catch(error){failed=true;result={...result,passed:false,errorCode:error.message,stage};}
finally{
 clearInterval(progress);result={...result,completedAt:new Date().toISOString(),elapsedSeconds:(Date.now()-started)/1000,...usage()};await writeFile('/profile/result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
 if(runtime&&runtime.exitCode===null){runtime.kill('SIGTERM');await Promise.race([once(runtime,'exit'),delay(12000)]);}
 process.exit(failed?1:0);
}
