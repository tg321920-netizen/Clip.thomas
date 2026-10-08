import { runMedia } from "../media-processing/MediaValidationService.mjs";
export async function measureAudioEnergy(filename) {
  const scan = await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v","error","-i",filename,"-vn","-af","aresample=16000,asetnsamples=n=80000:p=0,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-","-f","null","/dev/null"]);
  const windows=[]; let start=0;
  for(const line of scan.stdout.split("\n")) { const time=line.match(/pts_time:([\d.]+)/); if(time)start=Number(time[1]); const level=line.match(/RMS_level=([-\d.inf]+)/);if(level){const db=Number(level[1]);windows.push({start,end:start+5,db:Number.isFinite(db)?db:-100});} }
  const ordered=windows.map(w=>w.db).filter(db=>db>-90).sort((a,b)=>a-b);
  const low=ordered[Math.floor(ordered.length*.1)]??-60, high=ordered[Math.floor(ordered.length*.9)]??-10;
  return windows.map(w=>({...w,score:Math.max(0,Math.min(100,100*(w.db-low)/Math.max(6,high-low)))}));
}
export function windowEnergy(candidate, windows) {
  let seconds=0,total=0;
  for(const w of windows){const overlap=Math.max(0,Math.min(w.end,candidate.endTime)-Math.max(w.start,candidate.startTime));seconds+=overlap;total+=overlap*w.score;}
  return seconds?Math.round(total/seconds):null;
}
export function sentenceSegments(segments=[]) {
  const result=[];let current=null;
  for(const segment of segments){
    if(!current)current={...segment,words:[...(segment.words||[])]};
    else{current.endTime=segment.endTime;current.text+=` ${segment.text}`;current.words.push(...(segment.words||[]));}
    if(/[.!?…]["'»”)]?$/.test(current.text.trim())){result.push(current);current=null;}
  }
  if(current)result.push(current);return result;
}
