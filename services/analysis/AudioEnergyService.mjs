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
export function windowAudibility(candidate, windows) {
  let coveredSeconds = 0, total = 0;
  for (const window of windows) {
    const overlap = Math.max(0, Math.min(window.end, candidate.endTime) - Math.max(window.start, candidate.startTime));
    if (!Number.isFinite(window.db)) continue;
    coveredSeconds += overlap; total += overlap * window.db;
  }
  const meanDb = coveredSeconds > 0 ? total / coveredSeconds : null;
  return { coveredSeconds, meanDb, audible: meanDb !== null && meanDb >= -55 };
}
export function sentenceSegments(segments=[],{maxGapSeconds=8}={}) {
  const result=[];let current=null;
  for(const segment of segments){
    const previousSpeaker=current?.speakerId??current?.speaker,nextSpeaker=segment.speakerId??segment.speaker;
    if(current&&(segment.startTime-current.endTime>maxGapSeconds||
      (previousSpeaker!==undefined&&nextSpeaker!==undefined&&previousSpeaker!==nextSpeaker))){result.push(current);current=null;}
    if(!current)current={...segment,words:[...(segment.words||[])]};
    else{current.endTime=segment.endTime;current.text+=` ${segment.text}`;current.words.push(...(segment.words||[]));}
    if(/[.!?…]["'»”)]?$/.test(current.text.trim())){result.push(current);current=null;}
  }
  if(current)result.push(current);return result;
}


/** Low-resolution one-frame/second scene evidence; no object/emotion claims. */
export async function measureSceneChanges(filename) {
  const scan = await runMedia(process.env.FFMPEG_PATH || "ffmpeg", [
    "-v", "error", "-i", filename, "-an",
    "-vf", "fps=1,scale=160:-2,select=gt(scene\\,0.35),metadata=print:file=-",
    "-f", "null", "-",
  ]);
  return [...scan.stdout.matchAll(/pts_time:([\d.]+)/g)].map(match => Number(match[1]));
}

export function sceneActivity(candidate, times) {
  if (!Array.isArray(times)) return null;
  const cuts = times.filter(time => time >= candidate.startTime && time < candidate.endTime).length;
  return Math.min(100, Math.round(cuts * 10 / Math.max(1, candidate.duration) * 100));
}
