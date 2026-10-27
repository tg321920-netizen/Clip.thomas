import { LiveSessionStore } from './LiveSessionStore.mjs';
import { LiveMonitorService } from './LiveMonitorService.mjs';
import { IngestJobStore } from '../ingest/IngestJobStore.mjs';
import { JobStore } from '../JobStore.mjs';
import { resolveKickSource } from './KickPublicSourceService.mjs';
let sourceCache=null,sourceRequest=null;
async function sourceStatus(){
  if(sourceCache&&Date.now()-Date.parse(sourceCache.checkedAt)<30000)return sourceCache;
  if(!sourceRequest)sourceRequest=(async()=>{const checkedAt=new Date().toISOString();try{const input=await resolveKickSource('https://kick.com/westcol',{signal:AbortSignal.timeout(20000)});return sourceCache={status:input.metadata.sourceKind==='LIVE'?'LIVE':'VOD',checkedAt};}catch(error){return sourceCache={status:error.code==='SOURCE_OFFLINE'?'OFFLINE':'UNAVAILABLE',errorCode:error.code||'SOURCE_CHECK_FAILED',checkedAt};}finally{sourceRequest=null;}})();
  return sourceRequest;
}
export async function liveStatus({sessions=new LiveSessionStore(),ingests=new IngestJobStore(),media=new JobStore(),monitorStore=new LiveMonitorService(),resolveStatus=sourceStatus,env=process.env}={}){
  const [source,monitor,states,ingestJobs,mediaJobs,capacity]=await Promise.all([resolveStatus(),monitorStore.read(),sessions.list(),ingests.listWithIssues(100),media.listMediaWithIssues(100),sessions.capacity()]);
  const jobs=ingestJobs.jobs;
  const safeJob=j=>({id:j.id,type:j.type,status:j.status,stage:j.stage,progress:Number(j.progress)||0,errorCode:j.errorCode||null});
  return{channel:'westcol',source,monitor:{enabled:env.CLIPFORGE_LIVE_MONITOR_ENABLED==='true',status:monitor.status,storagePersistent:env.CLIPFORGE_STORAGE_PERSISTENT==='true',captureWorkerEnabled:env.CLIPFORGE_LIVE_CAPTURE_ENABLED==='true'},capacity,
    sessions:states.filter(s=>s.source.channel==='westcol').slice(0,10).map(s=>({id:s.id,sourceKind:s.source.sourceKind,captureStatus:s.capture.status,errorCode:s.capture.errorCode||null,recoverableErrors:s.capture.recoverableErrors||[],archiveFailures:s.segments.filter(x=>x.archive?.status==="FAILED").length,lastSegment:s.segments.at(-1)?{index:s.segments.at(-1).index,utc:s.segments.at(-1).sourceStartUtc,sha256:s.segments.at(-1).sha256}:null,segments:s.segments.length,originalsArchived:s.segments.filter(x=>x.archive?.status==='READY').length+(s.originalFiles||[]).length,chatStatus:s.chat.status,checkpoint:s.checkpoint||null,gaps:s.gaps.slice(-10)})),
    jobs:jobs.filter(j=>['LIVE_CAPTURE','INGEST_LIVE_WINDOW'].includes(j.type)&&!['COMPLETED','CANCELLED'].includes(j.status)).map(safeJob),metadataIssueCount:mediaJobs.issues.length+ingestJobs.issues.length,mediaJobs:mediaJobs.jobs.filter(j=>!['READY','CANCELLED'].includes(j.status)).map(safeJob),publishing:'OFF'};
}
