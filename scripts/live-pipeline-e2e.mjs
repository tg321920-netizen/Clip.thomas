// Technical integration: original synthetic Spanish narration + test pattern.
// Native media, Whisper, local editorial, real private R2. Chat is simulated.
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LiveSessionStore,liveId} from '../services/live/LiveSessionStore.mjs';
import {LiveCaptureService} from '../services/live/LiveCaptureService.mjs';
import {LiveObservationStore} from '../services/live/LiveObservationStore.mjs';
import {LiveArchiveService} from '../services/live/LiveArchiveService.mjs';
import {IngestJobStore} from '../services/ingest/IngestJobStore.mjs';
import {JobStore} from '../services/JobStore.mjs';
import {materializeLiveWindow} from '../services/live/LiveWindowService.mjs';
import {BestClipsService} from '../services/analysis/BestClipsService.mjs';
import {openHlsInput} from '../services/ingest/HlsInputService.mjs';
import {runMedia,validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {EspeakNewsTtsProvider} from '../services/news/EspeakNewsTtsProvider.mjs';
import {loadProjectFile} from '../lib/project-files.mjs';
import {R2ObjectStore} from '../services/storage/R2ObjectStore.mjs';
if(process.env.CLIPFORGE_RUN_MEDIA_TESTS!=='true'||process.env.CLIPFORGE_RUN_R2_TESTS!=='true')throw new Error('Explicit media and real private R2 test opt-ins required.');
const root=path.resolve('artifacts/stability/pipeline-'+new Date().toISOString().replaceAll(':','-')),feed=path.join(root,'feed');await mkdir(feed,{recursive:true});process.env.CLIPFORGE_STORAGE_DIR=path.join(root,'storage');await mkdir(process.env.CLIPFORGE_STORAGE_DIR,{recursive:true});
for(const key of ['CLIPFORGE_AGENT_ENABLED','CLIPFORGE_AGENT_REAL_PUBLISHING','CLIPFORGE_CONTENT_REAL_PUBLISHING','CLIPFORGE_SMART_PUBLISH_ON_BOOT','CLIPFORGE_LIVE_MONITOR_ENABLED'])process.env[key]='false';process.env.CLIPFORGE_REDIS_URL='';process.env.REDIS_URL='';process.env.WHISPER_LANGUAGE='auto';process.env.WHISPER_CPP_THREADS='2';process.env.WHISPER_WORD_TIMESTAMPS='true';process.env.CLIPFORGE_ANALYSIS_PROVIDER='heuristic';
const scripts=JSON.parse(await readFile(new URL('./fixtures/editor-language-narrations.json',import.meta.url),'utf8')),wav=path.join(feed,'own.wav');await new EspeakNewsTtsProvider({voice:'es',speed:135}).synthesize({text:scripts.es.slice(0,3).join(' '),outputPath:wav});
await runMedia(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-y','-f','lavfi','-i','testsrc2=size=320x180:rate=10','-i',wav,'-t','90','-c:v','libx264','-threads','1','-preset','ultrafast','-g','60','-bf','0','-pix_fmt','yuv420p','-c:a','aac','-f','hls','-hls_time','6','-hls_list_size','0','-hls_flags','program_date_time+independent_segments','-hls_segment_filename',path.join(feed,'part-%04d.ts'),path.join(feed,'media.m3u8')]);
const playlist=await readFile(path.join(feed,'media.m3u8'),'utf8'),startedAt=playlist.match(/#EXT-X-PROGRAM-DATE-TIME:([^\n]+)/)[1].trim();
const source={platform:'OWNED_HLS',channel:'owned-technical-fixture',channelId:'123',sourceId:'pipeline-'+Date.now(),sourceKind:'VOD',startedAt};
const server=http.createServer(async(req,res)=>{try{const file=new URL(req.url,'http://localhost').pathname.slice(1);if(!/^(media\.m3u8|part-\d{4}\.ts)$/.test(file)){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl');res.end(await readFile(path.join(feed,file)));}catch{res.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const sessions=new LiveSessionStore(),observations=new LiveObservationStore({env:{}}),ingest=new IngestJobStore(),media=new JobStore(),id=liveId(root);
const bins=Array.from({length:17},(_,i)=>({utc:new Date(Date.parse(startedAt)+(i-6)*10000).toISOString(),messages:i===11?90:4,uniqueSenders:i===11?60:4,distinctTexts:i===11?5:4,dominantTextCount:i===11?70:1,dominantTextSenders:i===11?45:1}));await observations.save({id,source,bins,chatStatus:'SIMULATED_TEST_COUNTERS'});
try{
 const capture=new LiveCaptureService({sessions,observations,resolveSource:async()=>({metadata:source})});await capture.run({id,source:{url:origin+'/media.m3u8',expectedSource:source,captureSeconds:90,segmentSeconds:30,onlyChatReactions:true}},{captureOptions:{inputFormat:'HLS',isVodSource:true,hlsInputFactory:(url,options)=>openHlsInput(url,{...options,request:fetch,validateUrl:async raw=>{const u=new URL(raw);if(u.origin!==origin)throw new Error('Fixture only');return u.toString();}})}});
 const session=await sessions.get(id),window=session.windows.find(w=>w.coreIndex===1);assert.ok(window);const job=await ingest.get(window.jobId);const materialized=await materializeLiveWindow(job,{sessions,observations});await ingest.complete(job,materialized);
 const clipsJob=await media.get(materialized.clipsJobId);const result=await new BestClipsService().render(clipsJob.projectId,clipsJob.payload);assert.ok(result.actualCount>0);const project=await loadProjectFile(result.projectId);project.testOnly=true;for(const c of project.clips){c.title='PRUEBA TÉCNICA · NO PUBLICAR';}
 // Persist the test label before external archival; this never approves a clip.
 const {replaceProjectFile}=await import('../lib/project-files.mjs');await replaceProjectFile(project.id,project);await media.complete({...clipsJob,result,validation:result.validation});
 const archive=new LiveArchiveService({sessions});for(let i=0;i<session.segments.length;i++)await archive.process(id);
 const saved=await sessions.get(id);assert.ok(saved.segments.every(s=>s.archive.status==='READY'));const receipts=saved.windows.find(w=>w.jobId===window.jobId).archives;assert.equal(receipts.length,result.actualCount);
 const cloud=new R2ObjectStore(),downloads=[];
 for(const receipt of receipts){const object=await cloud.get(`clipforge-managed/v1/media/${receipt.id}.mp4`),chunks=[];for await(const b of object.body)chunks.push(b);const bytes=Buffer.concat(chunks);assert.equal(createHash('sha256').update(bytes).digest('hex'),receipt.sha256);const file=path.join(root,receipt.id+'.mp4');await writeFile(file,bytes);const validation=await validateMp4(file,{requireAudio:true,width:1080,height:1920});downloads.push({archiveId:receipt.id,sha256:receipt.sha256,file,validation});}
 const restored=await archive.restore(id,{targetRoot:path.join(root,'restored'),workersPaused:true});
 const evidence={checkedAt:new Date().toISOString(),kind:'OWNED_SYNTHETIC_SPANISH_VOD_HLS_INTEGRATION',realWestcol:false,commercialQuality:false,sourceAndChatSimulated:true,nativeCapture:true,actualWhisper:true,externalAi:false,analysisKind:'LOCAL_HEURISTIC',subtitles:false,sourceLanguage:project.transcript.language,segments:session.segments.length,requestedCount:clipsJob.payload.count,actualCount:result.actualCount,privateR2:true,originalsRestored:restored.originals,downloads};await writeFile(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({ok:true,evidence:path.join(root,'evidence.json'),clips:downloads.length}));
}catch(error){console.error(JSON.stringify({failed:true,code:error.code||null,message:error.message}));throw error;}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
