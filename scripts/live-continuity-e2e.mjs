import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdir,readFile,writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import { LiveCaptureService } from '../services/live/LiveCaptureService.mjs';
import { LiveSessionStore,liveId } from '../services/live/LiveSessionStore.mjs';
import { LiveObservationStore } from '../services/live/LiveObservationStore.mjs';
import { enqueueReadyLiveWindows,inspectLiveSegment } from '../services/live/LiveWindowService.mjs';
import { openHlsInput } from '../services/ingest/HlsInputService.mjs';
import { hashFile } from '../services/ingest/ResumableUploadStore.mjs';
if(process.env.CLIPFORGE_RUN_MEDIA_TESTS!=='true')throw new Error('Requiere autorización audiovisual CLIPFORGE_RUN_MEDIA_TESTS=true.');
const root=path.resolve('artifacts/stability/continuous-hls-'+new Date().toISOString().replaceAll(':','-'));
await mkdir(path.join(root,'feed'),{recursive:true});process.env.CLIPFORGE_STORAGE_DIR=path.join(root,'storage');await mkdir(process.env.CLIPFORGE_STORAGE_DIR,{recursive:true});
const source={platform:'OWNED_HLS',channel:'owned-technical-fixture',channelId:'123',sourceId:'owned-'+Date.now(),sourceKind:'LIVE',startedAt:new Date().toISOString()};
const generator=spawn(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-y','-re','-f','lavfi','-i','testsrc2=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=16000','-t','100','-c:v','libx264','-threads','1','-preset','ultrafast','-g','40','-bf','0','-pix_fmt','yuv420p','-c:a','aac','-f','hls','-hls_time','4','-hls_list_size','8','-hls_flags','program_date_time+independent_segments+temp_file','-hls_segment_filename',path.join(root,'feed','part-%05d.ts'),path.join(root,'feed','live.m3u8')],{stdio:['ignore','ignore','pipe']});
let generatorError='';generator.stderr.on('data',b=>generatorError+=b.toString());const generated=new Promise((resolve,reject)=>generator.once('close',c=>c===0?resolve():reject(new Error('Owned generator failed: '+generatorError.slice(-500)))));generated.catch(()=>{});
let transient503=0;
const server=http.createServer(async(req,res)=>{try{const parts=new URL(req.url,'http://localhost').pathname.split('/').filter(Boolean),name=parts.at(-1);if(!/^(?:live\.m3u8|part-\d{5}\.ts)$/.test(name)){res.writeHead(404).end();return;}if(parts[0]==='recovery'&&name.endsWith('.ts')&&transient503===0){transient503++;res.writeHead(503).end();return;}const body=await readFile(path.join(root,'feed',name));res.setHeader('Content-Type',name.endsWith('.ts')?'video/mp2t':'application/vnd.apple.mpegurl');res.end(body);}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const validateUrl=async raw=>{const u=new URL(raw);if(u.origin!==origin)throw new Error('Owned fixture only');return u.toString();};
const factory=(url,options)=>openHlsInput(url,{...options,validateUrl,request:fetch});
const sessions=new LiveSessionStore(),observations=new LiveObservationStore({env:{}});
const queued=new Map();const jobs={get:async id=>queued.get(id),enqueueLiveWindow:async input=>{queued.set(input.id,{...input,status:'QUEUED'});}};
const enqueue=(id,options)=>enqueueReadyLiveWindows(id,{...options,jobs,mediaJobs:{get:async()=>null},maxPending:1});
const service=new LiveCaptureService({sessions,observations,resolveSource:async()=>({metadata:source}),enqueue});
const overall=new AbortController();let tasks=[];
const capture=(id,prefix,signal)=>service.run({id,source:{url:origin+'/'+prefix+'/live.m3u8',expectedSource:source,captureSeconds:100,segmentSeconds:30}},{signal:signal?AbortSignal.any([overall.signal,signal]):overall.signal,captureOptions:{hlsInputFactory:factory}});
try{
  while(true){try{await readFile(path.join(root,'feed','live.m3u8'));break;}catch{await new Promise(r=>setTimeout(r,250));}}
  const continuous=liveId(root+':continuous'),recovery=liveId(root+':recovery'),controller=new AbortController();
  const full=capture(continuous,'continuous');
  const interrupt=setTimeout(()=>controller.abort(),39000);
  const recovered=(async()=>{try{await capture(recovery,'recovery',controller.signal);}catch(error){assert.equal(error.code,'LIVE_INTERRUPTED');}finally{clearTimeout(interrupt);}const before=await sessions.get(recovery);assert.ok(before.segments.length);const hashes=before.segments.map(s=>[s.relativePath,s.sha256]);await delay(40000,undefined,{signal:overall.signal});await capture(recovery,'recovery');for(const[file,sha]of hashes)assert.equal(await hashFile(path.join(sessions.root,file)),sha);return hashes.length;})();
  tasks=[full,recovered];await Promise.all([...tasks,generated]);
  const results=[];
  for(const id of [continuous,recovery]){const state=await sessions.get(id);for(const segment of state.segments){const check=await inspectLiveSegment(path.join(sessions.root,segment.relativePath));await sessions.validateSegment(id,segment.index,check);}const checked=await sessions.get(id);assert.ok(checked.segments.length>=3);assert.equal(new Set(checked.segments.map(s=>s.index)).size,checked.segments.length);assert.ok(checked.segments.every(s=>s.validation.fullDecode&&s.validation.hasAudio));assert.ok(checked.windows.length<=1);results.push({sessionId:id,segments:checked.segments.map(s=>({index:s.index,sha256:s.sha256,durationSeconds:s.durationSeconds,sourceStartUtc:s.sourceStartUtc,validation:s.validation})),gaps:checked.gaps,queuedWindows:checked.windows.length,capture:checked.capture.status});}
  assert.equal(transient503,1);assert.ok(results[1].gaps.some(g=>g.durationSeconds>0),'An outage beyond the moving HLS window must record the lost source interval');
  const evidence={kind:'OWNED_MOVING_HLS_TECHNICAL_FIXTURE',commercialQuality:false,actualWestcol:false,createdAt:new Date().toISOString(),nativeCapture:true,realWallSeconds:100,transientHttp503:transient503,slowEditorQueueLimit:1,results};await writeFile(path.join(root,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({ok:true,evidence:path.join(root,'evidence.json'),results:results.map(r=>({segments:r.segments.length,gaps:r.gaps.length,queued:r.queuedWindows}))}));
}finally{overall.abort();await Promise.allSettled(tasks);generator.kill('SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));}
