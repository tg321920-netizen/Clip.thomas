import { LiveArchiveService } from "../services/live/LiveArchiveService.mjs";
import { getClipLibraryStatus } from "../services/storage/ClipLibraryService.mjs";
if(!getClipLibraryStatus().configured){console.info("Archivo privado de originales sin configurar.");process.exit(0);}
const archive=new LiveArchiveService(), once=process.argv.includes("--once");let stopping=false;
process.on("SIGTERM",()=>{stopping=true;});process.on("SIGINT",()=>{stopping=true;});
do{
  for(const session of await archive.sessions.list()){
    if(stopping)break;
    try{const snapshot=await archive.process(session.id);console.info(JSON.stringify({sessionId:session.id,checkpoint:snapshot?.createdAt||null}));}
    catch(error){console.warn(JSON.stringify({sessionId:session.id,code:error.code||"LIVE_ARCHIVE_FAILED"}));}
  }
  if(once||stopping)break;await new Promise(r=>setTimeout(r,10000));
}while(!stopping);
