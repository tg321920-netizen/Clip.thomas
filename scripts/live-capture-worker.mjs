import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { LiveCaptureService } from "../services/live/LiveCaptureService.mjs";
const jobs=new IngestJobStore(), capture=new LiveCaptureService(), once=process.argv.includes("--once");
if(process.env.CLIPFORGE_LIVE_CAPTURE_ENABLED!=="true" || process.env.CLIPFORGE_LIVE_RIGHTS_CONFIRMED!=="true" || process.env.CLIPFORGE_STORAGE_PERSISTENT!=="true"){
  console.info(JSON.stringify({status:"DISABLED",reason:"Capture worker requires explicit enablement, source authorization and a verified persistent volume.",publication:"OFF"}));process.exit(0);
}
let stopping=false, active;
process.on("SIGTERM",()=>{stopping=true;active?.abort();});process.on("SIGINT",()=>{stopping=true;active?.abort();});
do {
  const job=await jobs.claimNext(["LIVE_CAPTURE"]);
  if(!job){if(once)break;await new Promise(r=>setTimeout(r,1000));continue;}
  active=new AbortController();
  const heartbeat=setInterval(()=>void jobs.heartbeat(job.id).catch(()=>active.abort()),15000);
  const cancellation=setInterval(()=>void jobs.get(job.id).then(f=>{if(f?.status==="CANCELLED")active.abort();}).catch(()=>active.abort()),1000);
  try{await jobs.complete(job,await capture.run(job,{signal:active.signal,onProgress:(p,s,d)=>jobs.updateProgress(job.id,p,s,d)}));}
  catch(error){await jobs.fail(job,error,{retryable:error.retryable===true});console.warn(JSON.stringify({jobId:job.id,code:error.code||"LIVE_CAPTURE_FAILED"}));}
  finally{clearInterval(heartbeat);clearInterval(cancellation);active=null;}
  if(once)break;
}while(!stopping);
