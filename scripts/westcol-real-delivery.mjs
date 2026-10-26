// Produce an authentic Westcol clip from locally preserved, verified footage.
// Reuses ClipForge analysis/render/job/archive services. Never synthesizes media.
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {loadProjectFile,replaceProjectFile} from '../lib/project-files.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {measureAudioEnergy,windowEnergy,measureSceneChanges,sceneActivity} from '../services/analysis/AudioEnergyService.mjs';
import {scoreCandidate} from '../services/analysis/ViralScoreService.mjs';
import {sampleCandidateFrames} from '../services/analysis/VisualEvidenceService.mjs';
import {createContentAnalysisProvider} from '../services/analysis/createContentAnalysisProvider.mjs';
import {BestClipsService} from '../services/analysis/BestClipsService.mjs';
import {LiveObservationStore,alignChatToCapture} from '../services/live/LiveObservationStore.mjs';
import {chatEvidenceForWindow} from '../services/analysis/ChatActivityService.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {LiveArchiveService} from '../services/live/LiveArchiveService.mjs';
import {JobStore} from '../services/JobStore.mjs';
const sourceUrl='https://kick.com/westcol/videos/01a17413-f760-7067-aa90-2e6d458a1aa6';
const arg=name=>process.argv.find(a=>a.startsWith(`--${name}=`))?.slice(name.length+3);
if(!process.argv.includes('--rights-confirmed'))throw new Error('Requiere autorización del material real.');
const projectId=arg('project')||'d61eab18-d29f-499e-8cbd-35d02d8596c9';
if(projectId!=='d61eab18-d29f-499e-8cbd-35d02d8596c9')throw new Error('Esta entrega está vinculada a la ventana real preservada y verificada.');
for(const key of ['CLIPFORGE_AGENT_ENABLED','CLIPFORGE_AGENT_REAL_PUBLISHING','CLIPFORGE_CONTENT_REAL_PUBLISHING','CLIPFORGE_SMART_PUBLISH_ON_BOOT','CLIPFORGE_LIVE_MONITOR_ENABLED'])process.env[key]='false';
const root=process.env.CLIPFORGE_STORAGE_DIR||path.resolve('storage'),project=await loadProjectFile(projectId);
if(project.source.originUrl!==sourceUrl||project.transcript?.status!=='COMPLETED')throw new Error('No coincide la fuente real o falta transcripción.');
const lines=(await readFile('artifacts/real-westcol/recovery/source-validation.jsonl','utf8')).trim().split('\n').map(JSON.parse),validated=lines.find(v=>v.id===projectId);
const file=path.join(root,project.source.relativePath);if(!validated?.validation?.fullDecode||await hashFile(file)!==validated.sha256)throw new Error('Falta una fuente íntegra y decodificada.');
const alignment=JSON.parse(await readFile('artifacts/real-westcol/recovery/hotel-alignment.json','utf8'));
if(alignment.correlation<0.95||alignment.nextBestSeparatedCorrelation>0.5)throw new Error('La posición real no tiene una correspondencia de audio inequívoca.');
const inventory=JSON.parse(await readFile('artifacts/real-westcol/chat-inventory.json','utf8')),metadata=inventory.source;
const startUtc=new Date(Date.parse(alignment.anchorSourceUtc)-alignment.offsetInRecoveredSeconds*1000).toISOString();
const originalError=project.source.captureValidation?.priorRejection||project.source.captureValidation||null;
project.source.captureValidation={...validated.validation,priorRejection:originalError,reverifiedAfterConcurrentWriterStopped:true};
project.source.capture={...(project.source.capture||{}),vodStartSeconds:alignment.recoveredVodStartSeconds,sourceRanges:[{offsetSeconds:0,sourceStartUtc:startUtc}],timingEvidence:alignment};
project.source.originalAvailability={state:'NOT_LISTED_PUBLICLY',checkedAt:new Date().toISOString()};
const observations=await new LiveObservationStore().loadForSource(metadata),chat=alignChatToCapture(observations.bins,project.source.capture,project.source.durationSeconds);
project.liveObservation={source:metadata,channel:'westcol',captureType:'VOD',chatStatus:chat.length?'SAVED_OBSERVATIONS':'NOT_OBSERVED_FOR_INTERVAL',chatActivityWindows:chat,clockUncertaintySeconds:10};
await replaceProjectFile(project.id,project);
const outputDirectory=path.resolve('artifacts/real-westcol/delivery');await mkdir(outputDirectory,{recursive:true});
let cached=null;if(process.argv.includes('--resume-selection')){cached=JSON.parse(await readFile(path.join(outputDirectory,'selection.json'),'utf8'));if(cached.projectId!==projectId||cached.sourceSha256!==validated.sha256)throw new Error('La selección guardada no corresponde a estos bytes.');}
const [energy,scenes]=cached?[[],[]]:await Promise.all([measureAudioEnergy(file),measureSceneChanges(file)]);
const intervals=[['watch-at-the-match',110.2,139.2],['outfit-no-bag',76.2,109.2],['no-showing-off',100.2,139.2]];
const baseline=intervals.map(([id,startTime,endTime])=>{const candidate={id,startTime,endTime,duration:endTime-startTime,title:'Preparándose para ir al estadio',hook:'Una broma sobre el atuendo para el partido',reason:'Conversación real distinta de cámara VIP y Nike; necesita revisión humana.',text:project.transcript.segments.filter(s=>s.endTime>startTime&&s.startTime<endTime).map(s=>s.text).join(' '),contentProfile:'ENTERTAINMENT',analysisMethod:'REAL_TRANSCRIPT_CONTEXT_REVIEW',visualActivity:sceneActivity({startTime,endTime,duration:endTime-startTime},scenes),chatEvidence:chatEvidenceForWindow({startTime,endTime},chat)};return{...candidate,...scoreCandidate(candidate,{audioEnergy:windowEnergy(candidate,energy)})};});
const frames=cached?cached.frames:await sampleCandidateFrames(project,baseline);let selected,modelResult={attempted:true,model:'glm-4.6v-flash',status:'PENDING'};
if(cached){selected=cached.selected;modelResult=cached.modelResult;}else try{
 const provider=createContentAnalysisProvider({providerName:'zai',env:{...process.env,CLIPFORGE_EDITOR_MODEL:'glm-4.6v-flash',CLIPFORGE_ZAI_MODEL:'glm-4.6v-flash',CLIPFORGE_EDITOR_VISION:'true'}});
 if(provider.model!=='glm-4.6v-flash')throw Object.assign(new Error('Modelo no autorizado.'),{code:'PAID_MODEL_BLOCKED'});
 const ranked=await provider.rank(baseline,{project,transcript:project.transcript,maxCandidates:1,contentProfile:'ENTERTAINMENT',frames});selected=ranked.slice(0,1);modelResult={...modelResult,status:'VALID_SELECTION',selected:selected.map(c=>({id:c.id,startTime:c.startTime,endTime:c.endTime,title:c.title,reason:c.reason,assessment:c.aiAssessment}))};
}catch(error){modelResult={...modelResult,status:'FAILED',code:error.code||'AI_UNAVAILABLE',diagnostics:error.diagnostics||null};if(error.code==='PAID_MODEL_BLOCKED'||error.diagnostics?.rejectedForContext>0)throw error;selected=[baseline[0]];}
await writeFile(path.join(outputDirectory,'selection.json'),JSON.stringify({sourceUrl,projectId,sourceSha256:validated.sha256,modelResult,chatObserved:chat.length>0,frames:frames.map(f=>({candidateId:f.candidateId,time:f.time})),selected},null,2));
console.log(JSON.stringify({stage:'REAL_SELECTION',modelStatus:modelResult.status,selected:selected.map(c=>({id:c.id,duration:c.duration,title:c.title})),chatObserved:chat.length>0}));
const digest=createHash('sha256').update(`westcol-real-v1:${validated.sha256}:${selected[0].id}:fill-0.59`).digest('hex'),outputId=`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}`;
const payload={projectId,count:1,minDuration:20,maxDuration:45,targetDuration:30,subtitles:false,contentProfile:'ENTERTAINMENT',framingMode:'FILL',focusX:0.59};
const jobs=new JobStore(),queued=await jobs.enqueueMedia('MEDIA_CLIPS',outputId,payload),owned=queued.status==='READY'?queued:await jobs.claimNext(['MEDIA_CLIPS'],queued.id);
if(!owned)throw new Error('Otro worker ya procesa esta selección.');
const heartbeat=setInterval(()=>void jobs.heartbeat(owned.id).catch(()=>{}),15000);heartbeat.unref();
let result;
try{result=await new BestClipsService({provider:{name:modelResult.status==='VALID_SELECTION'?'zai-editor-v1':'local-editorial-review',model:modelResult.status==='VALID_SELECTION'?'glm-4.6v-flash':null,visionEnabled:modelResult.status==='VALID_SELECTION',analyze:async()=>selected}}).render(outputId,payload,(status,stage,progress)=>jobs.transition(owned.id,status,stage,progress));await jobs.complete({...owned,result,validation:result.validation});}
catch(error){await jobs.fail(owned,error,{retryable:false});throw error;}finally{clearInterval(heartbeat);}
const output=await loadProjectFile(outputId),library=new ClipLibraryService(),receipts=[];
for(const clip of output.clips){clip.sourceReference={sourceUrl,sourceId:metadata.sourceId,sourceKind:'VOD',sourceProjectId:project.id,sourceSha256:validated.sha256,vodStartSeconds:alignment.recoveredVodStartSeconds+clip.startTime,vodEndSeconds:alignment.recoveredVodStartSeconds+clip.endTime,startUtc:new Date(Date.parse(startUtc)+clip.startTime*1000).toISOString(),endUtc:new Date(Date.parse(startUtc)+clip.endTime*1000).toISOString(),positionMethod:alignment.method,audioMatchCorrelation:alignment.correlation,chatObserved:chat.length>0};clip.chatEvidence=selected.find(c=>c.id===clip.candidateId)?.chatEvidence||null;const saved=await library.archive(output,clip);if(saved?.status!=='READY')throw new Error('No se confirmó el archivo privado.');clip.archive=saved;receipts.push({id:saved.id,clipId:clip.id,relativePath:clip.render.relativePath,sha256:await hashFile(path.join(root,clip.render.relativePath)),sizeBytes:saved.sizeBytes});}
await replaceProjectFile(outputId,output);
console.log(JSON.stringify({stage:'REAL_MP4_ARCHIVED',outputProjectId:outputId,clips:receipts.length}));
const archive=new LiveArchiveService();await archive.archiveOriginalProject(project,metadata,{validatedSource:validated});
await archive.sessions.update(project.id,s=>{if(!s.windows.some(w=>w.clipsJobId===owned.id))s.windows.push({jobId:project.id,coreIndex:0,projectId:project.id,clipsJobId:owned.id,status:'ARCHIVED',archives:receipts});});await archive.checkpoint(project.id);
const evidence={createdAt:new Date().toISOString(),realWestcol:true,synthetic:false,liveCapture:false,sourceUrl,source:metadata,sourceSha256:validated.sha256,sourceRecovery:'PRESERVED_REAL_CAPTURE_REVERIFIED_AFTER_LOCAL_WRITER_COLLISION',modelResult,chatObserved:chat.length>0,chatMissingReason:chat.length?null:'No saved chat covers this VOD interval; no messages inferred.',outputProjectId:outputId,jobId:owned.id,clips:output.clips.map(c=>({id:c.id,title:c.title,startTime:c.startTime,endTime:c.endTime,duration:c.duration,sourceReference:c.sourceReference,reason:c.reason,editorialReview:c.editorialReview,validation:c.render.validation,relativePath:c.render.relativePath,archive:c.archive})),receipts,publishing:'OFF'};
await writeFile(path.join(outputDirectory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({stage:'COMPLETE',newRealClips:receipts.length,evidence:path.join(outputDirectory,'evidence.json'),archiveIds:receipts.map(r=>r.id)}));
