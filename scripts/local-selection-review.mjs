// Real transcript + real audiovisual measurements; no model, clip or R2 write.
import path from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {getStorageRoot} from '../lib/storage-paths.mjs';
import {isProjectId} from '../lib/project-id.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {TranscriptCandidateProvider} from '../services/analysis/TranscriptCandidateProvider.mjs';
import {measureAudioEnergy,measureSceneChanges,sentenceSegments} from '../services/analysis/AudioEnergyService.mjs';
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3),id=arg('project');
if(!isProjectId(id)||!process.argv.includes('--rights-confirmed'))throw new Error('Indica --project=UUID --rights-confirmed de un vídeo propio/autorizado con transcripción real ya terminada.');
const root=getStorageRoot(),project=JSON.parse(await readFile(path.join(root,'projects',id+'.json'),'utf8'));
if(project.transcript?.status!=='COMPLETED')throw new Error('No hay transcripción real terminada. El recorte manual sigue disponible.');
const source=path.resolve(root,project.source.relativePath);
if(!source.startsWith(path.resolve(root)+path.sep))throw new Error('Ruta de fuente inválida.');
const sourceSha256=await hashFile(source),output=path.resolve(arg('output')||'artifacts/local-selection/'+id);await mkdir(output,{recursive:true});
const cacheFile=path.join(output,'measured-av.json');let measurements;
try{measurements=JSON.parse(await readFile(cacheFile,'utf8'));}catch{}
const reusedMeasurements=measurements?.sourceSha256===sourceSha256&&measurements.version===1;
if(!reusedMeasurements){
  const [audioEnergyWindows,sceneChanges]=await Promise.all([measureAudioEnergy(source),measureSceneChanges(source)]);
  measurements={version:1,sourceSha256,measuredAt:new Date().toISOString(),audioEnergyWindows,sceneChanges};
  await writeFile(cacheFile,JSON.stringify(measurements,null,2));
}
const provider=new TranscriptCandidateProvider(),candidates=await provider.analyze({
  transcript:{...project.transcript,segments:sentenceSegments(project.transcript.segments)},
  options:{minDuration:20,maxDuration:40,targetDuration:30,maxCandidates:5,contentProfile:'PODCAST',requireCompleteSentences:true},
  audioEnergyWindows:measurements.audioEnergyWindows,sceneChanges:measurements.sceneChanges,
});
const evidence={checkedAt:new Date().toISOString(),sourceSha256,source:'AUTHORIZED_EXISTING_VIDEO',provider:provider.name,
  transcriptProvider:project.transcript.provider,transcriptModel:project.transcript.model,realTranscriptReused:true,newAsr:false,
  reusedMeasurements,realAudioScanWindows:measurements.audioEnergyWindows.length,realSceneChanges:measurements.sceneChanges.length,
  candidateCount:candidates.length,candidates,observedChat:false,newModelCalls:0,newRenders:0,editorialApproval:false};
await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
console.log(JSON.stringify({provider:provider.name,candidateCount:candidates.length,candidates:candidates.map(c=>({start:c.startTime,end:c.endTime,duration:c.duration,speakerBasis:c.dialogueEvidence.speakerBasis})),reusedMeasurements,newModelCalls:0,newRenders:0}));
