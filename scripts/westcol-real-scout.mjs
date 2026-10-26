// Authorized real Westcol VOD only. This extracts source media, never generates
// visuals or narration, renders a selected clip, or invents historical chat.
import path from 'node:path';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolveKickSource} from '../services/live/KickPublicSourceService.mjs';
import {captureSegmentedStream} from '../services/ingest/UrlIngestService.mjs';
import {runMedia,validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
const sourceUrl='https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6';
if(process.env.CLIPFORGE_RUN_EXTERNAL_MEDIA_TESTS!=='true'||!process.argv.includes('--rights-confirmed'))throw new Error('Requiere captura externa autorizada y --rights-confirmed.');
const arg=name=>process.argv.find(v=>v.startsWith(`--${name}=`))?.slice(name.length+3);
const positions=(arg('positions')||'1200,3000,4800,7200,9000,9900').split(',').map(Number);
if(positions.length>8||positions.some(p=>!Number.isFinite(p)||p<0||p>10290))throw new Error('Elige hasta ocho posiciones válidas del VOD autorizado.');
const root=path.resolve('artifacts/real-westcol/scout-'+new Date().toISOString().replaceAll(':','-'));await mkdir(root,{recursive:true});
const source=await resolveKickSource(sourceUrl);
if(source.metadata.channel!=='westcol'||source.metadata.sourceKind!=='VOD')throw new Error('La fuente no corresponde al VOD autorizado.');
const results=[];
for(let offset=0;offset<positions.length;offset+=2){
 const batch=await Promise.allSettled(positions.slice(offset,offset+2).map(async requestedStart=>{
  const directory=path.join(root,String(requestedStart));let capture;
  const file=await captureSegmentedStream({url:source.url,inputFormat:'HLS',isVodSource:true,uploadDir:directory,startTimeSeconds:requestedStart,captureSeconds:6,segmentSeconds:30,onCaptureMetadata:async m=>{capture=m;}});
  const validation=await validateMp4(file,{requireAudio:true});
  const image=path.join(directory,'frame.jpg');await runMedia(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-y','-ss','2','-i',file,'-frames:v','1','-vf','scale=640:-2','-threads','1',image]);
  const entry={requestedStart,actualSourceStart:capture?.windowStartSeconds,sourceStartUtc:capture?.sourceRanges?.[0]?.sourceStartUtc||null,file,image,sha256:await hashFile(file),validation};
  await writeFile(path.join(directory,'source-evidence.json'),JSON.stringify({sourceUrl,source:source.metadata,...entry},null,2));console.log(JSON.stringify({position:requestedStart,actualSourceStart:entry.actualSourceStart,duration:validation.duration,image}));return entry;
 }));
 for(const item of batch){if(item.status==='fulfilled')results.push(item.value);else console.warn(JSON.stringify({errorCode:item.reason.code||'SCOUT_FAILED',message:item.reason.message}));}
}
await writeFile(path.join(root,'evidence.json'),JSON.stringify({kind:'REAL_WESTCOL_VOD_SCOUT',sourceUrl,source:source.metadata,results,notSelectedClips:true},null,2));console.log(JSON.stringify({root,realSource:true,selectedClips:0,scoutWindows:results.length}));
