import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,rm,readFile,writeFile,mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { LiveSessionStore,liveId } from "../services/live/LiveSessionStore.mjs";
import { enqueueReadyLiveWindows } from "../services/live/LiveWindowService.mjs";
import { LiveCaptureService, mergeObservedChatBins } from "../services/live/LiveCaptureService.mjs";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { EditorialEventStore } from "../services/analysis/EditorialEventStore.mjs";
const source={platform:"OWNED_HLS",channel:"owned",channelId:"123",sourceId:"owned-stream-1",sourceKind:"LIVE",startedAt:"2026-10-25T12:00:00Z"};
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
async function setup(){const root=await mkdtemp(path.join(os.tmpdir(),"clipforge-continuous-")),id=liveId(root),sessions=new LiveSessionStore({root});await sessions.create(id,source);return{root,id,sessions,clean:()=>rm(root,{recursive:true,force:true})};}
async function segment(f,index,{seconds=30,utc=index*30}={}){const relativePath=`live-sessions/${f.id}/capture/.stream-parts/part-${String(index).padStart(6,"0")}.ts`,file=path.join(f.root,relativePath),bytes=Buffer.from(`explicit fake segment ${index}`);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes);return{index,relativePath,sha256:hash(bytes),sizeBytes:bytes.length,durationSeconds:seconds,offsetSeconds:index*30,sourceStartUtc:new Date(Date.parse(source.startedAt)+utc*1000).toISOString(),closedAt:new Date().toISOString()};}
const observations={loadForSource:async()=>({bins:[]}),save:async()=>{}};
test("immutable originals deduplicate by index, record actual UTC gaps and reject changed retained bytes",async()=>{const f=await setup();try{
  const a=await segment(f,0),b=await segment(f,1,{utc:40});await f.sessions.addSegment(f.id,a);await f.sessions.addSegment(f.id,a);await f.sessions.addSegment(f.id,b);
  const state=await f.sessions.get(f.id);assert.equal(state.segments.length,2);assert.equal(state.gaps[0].durationSeconds,10);
  await assert.rejects(f.sessions.addSegment(f.id,{...a,sha256:"a".repeat(64)}),e=>e.code==="LIVE_SEGMENT_CHANGED");
  assert.equal(hash(await readFile(path.join(f.root,a.relativePath))),a.sha256);
}finally{await f.clean();}});
test("context windows overlap only in analysis, queue is bounded across materialization AND a slow editor",async()=>{const f=await setup();try{
  await f.sessions.update(f.id,s=>{s.capture.status="CAPTURING";});for(let i=0;i<5;i++)await f.sessions.addSegment(f.id,await segment(f,i));
  const queued=new Map(),jobs={get:async id=>queued.get(id),enqueueLiveWindow:async input=>{queued.set(input.id,{...input,status:"QUEUED"});}},mediaJobs={get:async()=>({status:"PROCESSING"})};
  const options={sessions:f.sessions,jobs,mediaJobs,observations,maxPending:2};
  assert.equal((await enqueueReadyLiveWindows(f.id,options)).pending,2);assert.equal(queued.size,2);
  const list=[...queued.values()];assert.deepEqual(list[1].segmentIndices,[0,1,2]);
  for(const j of queued.values()){j.status="COMPLETED";j.result={clipsJobId:"slow-render"};}
  assert.equal((await enqueueReadyLiveWindows(f.id,options)).pending,2);assert.equal(queued.size,2);
  mediaJobs.get=async()=>({status:"READY"});await enqueueReadyLiveWindows(f.id,options);assert.equal(queued.size,4);
  assert.equal((await f.sessions.get(f.id)).segments.length,5,"capture originals survive downstream pressure");
}finally{await f.clean();}});
test("capture journals closed originals without waiting for any render or R2 operation; disk stop records a gap",async()=>{const f=await setup();try{
  let capturedOptions;const capture=async options=>{capturedOptions=options;for(let i=0;i<2;i++){const s=await segment(f,i);await options.onSegment(path.join(f.root,s.relativePath),i,{durationSeconds:30,offsetSeconds:i*30,sourceStartUtc:s.sourceStartUtc});}return{capture:{continuityBreaks:[]}};};
  const service=new LiveCaptureService({sessions:f.sessions,observations,resolveSource:async()=>({metadata:source}),capture,enqueue:async()=>({deferred:5}),capacity:async()=>({allowed:true})});
  await service.run({id:f.id,source:{url:"https://example.com/live.m3u8",expectedSource:source,captureSeconds:60}});
  assert.equal(capturedOptions.finalize,false);assert.equal((await f.sessions.get(f.id)).segments.length,2);
  service.capture=async options=>{await options.checkCapacity();};service.capacity=async()=>({allowed:false});
  await assert.rejects(service.run({id:f.id,source:{url:"https://example.com/live.m3u8",expectedSource:source}}),e=>e.code==="LIVE_STORAGE_LIMIT");
  assert.equal((await f.sessions.get(f.id)).gaps.at(-1).reason,"LIVE_STORAGE_LIMIT");
  service.capacity=async()=>({allowed:true});service.capture=async()=>({capture:{continuityBreaks:[]}});
  await service.run({id:f.id,source:{url:"https://example.com/live.m3u8",expectedSource:source}});
  const recovered=await f.sessions.get(f.id);assert.equal(recovered.capture.errorCode,null);assert.equal(recovered.capture.lastFailure.code,"LIVE_STORAGE_LIMIT");
  service.resolveSource=async()=>({metadata:{...source,sourceId:"different",startedAt:"2026-10-26T12:00:00Z"}});
  await assert.rejects(service.run({id:f.id,source:{url:"https://example.com/live.m3u8",expectedSource:source}}),e=>e.code==="LIVE_SOURCE_CHANGED");
}finally{await f.clean();}});
test("capture and materialization use separate claims, with bounded editorial priority and deterministic IDs",async()=>{const f=await setup(),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=f.root;try{
  const jobs=new IngestJobStore(),capture=await jobs.create({id:f.id,url:"https://kick.com/westcol",mode:"STREAM",captureSession:true,expectedSource:source});
  const low=liveId("low"),high=liveId("high");for(const[id,priority]of[[low,0],[high,80]])await jobs.enqueueLiveWindow({id,sessionId:f.id,coreIndex:priority,segmentIndices:[0],priority});
  assert.equal((await jobs.claimNext(["INGEST_LIVE_WINDOW"])).id,high);assert.equal((await jobs.claimNext(["LIVE_CAPTURE"])).id,capture.id);
  assert.equal((await jobs.claimNext(["INGEST_LIVE_WINDOW"])).id,low);
  assert.equal((await jobs.enqueueLiveWindow({id:high,sessionId:f.id,coreIndex:80,segmentIndices:[0]})).attempts,1);
}finally{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await f.clean();}});
test("cross-batch event claims are atomic and never merge different transmissions",async()=>{const f=await setup();try{
  const events=new EditorialEventStore({root:f.root}),candidate={id:"candidate",text:"La conversación explica un momento completo con suficientes palabras distintas para revisar su contexto audiovisual.",chatEvidence:{peakUtc:"2026-10-25T12:00:30Z"}};
  const results=await Promise.all([events.reserve(source,candidate,"output-a"),events.reserve(source,candidate,"output-b")]);assert.equal(results.filter(Boolean).length,1);
  const owner=results[0]?"output-a":"output-b";await events.confirm(source,candidate.id,owner);
  assert.equal(await events.reserve(source,{...candidate,id:"next",chatEvidence:{peakUtc:"2026-10-25T12:00:40Z"}},"output-c"),false);
  assert.equal(await events.reserve({...source,sourceId:"another-stream"},candidate,"output-c"),true);
  assert.doesNotMatch(await readFile(events.file(source),"utf8"),/conversación|palabras/u);
}finally{await f.clean();}});

test('similar images alone do not suppress a different conversation but corroborate similar text nearby',async()=>{
  const f=await setup();try{
    const events=new EditorialEventStore({root:f.root}),a={id:'a',text:'Uno dos tres cuatro cinco seis siete ocho nueve diez once doce.',visualFingerprint:'0123456789abcdef',chatEvidence:{peakUtc:'2026-10-25T12:00:00Z',isPeak:true}};
    assert.equal(await events.reserve(source,a,'owner-a'),true);await events.confirm(source,a.id,'owner-a');
    assert.equal(await events.reserve(source,{...a,id:'b',text:'Uno dos tres cuatro cinco seis siete ocho nueve diez trece catorce.',chatEvidence:{peakUtc:'2026-10-25T12:01:00Z',isPeak:true}},'owner-b'),false);
    assert.equal(await events.reserve(source,{...a,id:'c',text:'Esta discusión explica otras causas y ofrece una conclusión completamente distinta con suficiente contexto.',chatEvidence:{peakUtc:'2026-10-25T12:01:00Z',isPeak:true}},'owner-c'),true);
  }finally{await f.clean();}
});

test('a recovered initial HTTP failure keeps its safe diagnostic and unavailable opening interval',async()=>{
 const f=await setup();try{
  const service=new LiveCaptureService({sessions:f.sessions,observations,resolveSource:async()=>({metadata:source}),capacity:async()=>({allowed:true}),enqueue:async()=>{},capture:async options=>{
   await options.onDiagnostic({type:'HLS_ERROR',stage:'SEGMENT_OPEN',status:503,code:'HLS_UPSTREAM_HTTP',url:'https://private.invalid/?token=must-not-persist'});
   await options.onCaptureMetadata({playlistStartUtc:source.startedAt,firstServedProgramUtc:'2026-10-25T12:00:04Z',resumedSeconds:0,sourceRanges:[]});return{capture:{continuityBreaks:[]}};
  }});await service.run({id:f.id,source:{url:'https://example.com/live.m3u8',expectedSource:source,captureSeconds:60}});
  const state=await f.sessions.get(f.id);assert.equal(state.gaps[0].durationSeconds,4);assert.equal(state.capture.recoverableErrors[0].status,503);assert.doesNotMatch(JSON.stringify(state),/private.invalid|must-not-persist/);
 }finally{await f.clean();}
});

test('capacity tolerates a listed temporary file disappearing, but other filesystem errors still fail closed',async()=>{
 const f=await setup();try{
  const {liveMediaSize}=await import('../services/live/LiveSessionStore.mjs');const file=path.join(f.root,'session.mutation-lock');await writeFile(file,'transient lock');
  const size=await liveMediaSize(f.root,{statFile:async current=>{if(current===file){await rm(file);throw Object.assign(new Error('gone after readdir'),{code:'ENOENT'});}return{size:0};}});assert.equal(size,0);
  await writeFile(file,'permission failure fixture');await assert.rejects(liveMediaSize(f.root,{statFile:async()=>{throw Object.assign(new Error('blocked'),{code:'EACCES'});}}),e=>e.code==='EACCES');
 }finally{await f.clean();}
});

test('ordinary chat activity is not a reaction anchor for suppressing a distinct event',async()=>{const f=await setup();try{
 const events=new EditorialEventStore({root:f.root});
 const a={id:'old',text:'Un comentario anterior sobre zapatillas y un contrato con una marca.',chatEvidence:{peakUtc:'2026-10-25T12:00:00Z',isCollectiveReaction:true}};
 assert.equal(await events.reserve(source,a,'one'),true);await events.confirm(source,a.id,'one');
 const b={id:'new',text:'Otro acontecimiento donde el protagonista se acuerda de una prenda olvidada.',chatEvidence:{peakUtc:'2026-10-25T12:00:10Z',isCollectiveReaction:false,isPeak:false}};
 assert.equal(await events.reserve(source,b,'two'),true);
}finally{await f.clean();}});

test('an operator claims a specific queued ingest once instead of writing concurrently with the worker',async()=>{
 const f=await setup(),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=f.root;try{
  const jobs=new IngestJobStore(),a=await jobs.create({url:'https://kick.com/westcol',mode:'STREAM'}),b=await jobs.create({url:'https://kick.com/westcol',mode:'STREAM'});
  const claims=await Promise.all([jobs.claimNext(['INGEST_URL'],b.id),jobs.claimNext(['INGEST_URL'],b.id)]);assert.equal(claims.filter(Boolean).length,1);assert.equal(claims.find(Boolean).id,b.id);assert.equal((await jobs.get(a.id)).status,'QUEUED');
 }finally{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await f.clean();}
});

test('targeting a media job preserves other queued work and executes stale-state recovery without leaking a target variable',async()=>{
 const f=await setup(),previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=f.root;try{
  const {JobStore}=await import('../services/JobStore.mjs'),jobs=new JobStore();
  const a=await jobs.enqueueMedia('MEDIA_CLIPS',liveId('media-a'),{}),b=await jobs.enqueueMedia('MEDIA_CLIPS',liveId('media-b'),{});
  const claimed=await jobs.claimNext(['MEDIA_CLIPS'],b.id);assert.equal(claimed.id,b.id);assert.equal((await jobs.get(a.id)).status,'QUEUED');assert.equal(await jobs.claimNext(['MEDIA_CLIPS'],b.id),null);await jobs.release(b.id);
 }finally{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await f.clean();}
});

test('chat reconnects retain complete history and never sum partial buckets or promote coverage',()=>{
 const old={utc:'2026-10-25T17:00:00Z',messages:20,complete:true},partial={...old,messages:50,complete:false};
 const next={utc:'2026-10-25T17:00:10Z',messages:7,complete:false};
 assert.deepEqual(mergeObservedChatBins([old,partial,next,next]),[old,next]);
 assert.equal(mergeObservedChatBins([old,{...old,messages:25}])[0].messages,25);
});

test('window coordination preserves the session chat-preferred AV fallback after worker restart',async()=>{
 const f=await setup();try{
  await f.sessions.update(f.id,s=>{s.capture.status='ENDED';s.selectionPolicy={onlyChatReactions:false,preferChatReactions:true,chatReactionLagSeconds:8};});
  await f.sessions.addSegment(f.id,await segment(f,0,{seconds:60}));
  const queued=[];await enqueueReadyLiveWindows(f.id,{sessions:f.sessions,jobs:{get:async()=>null,enqueueLiveWindow:async j=>queued.push(j)},mediaJobs:{get:async()=>null},observations:{loadForSource:async()=>({bins:[]})}});
  assert.equal(queued.length,1);assert.equal(queued[0].onlyChatReactions,false);assert.equal(queued[0].preferChatReactions,true);assert.equal(queued[0].chatReactionLagSeconds,8);
 }finally{await f.clean();}
});
