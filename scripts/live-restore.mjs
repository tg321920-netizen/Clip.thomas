import { LiveArchiveService } from "../services/live/LiveArchiveService.mjs";
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const result=await new LiveArchiveService().restore(arg("session"),{targetRoot:arg("target"),workersPaused:process.argv.includes("--workers-paused")});
console.info(JSON.stringify(result));
