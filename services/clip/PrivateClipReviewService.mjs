import {stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {ClipLibraryService} from '../storage/ClipLibraryService.mjs';
import {loadProjectFile,replaceProjectFile} from '../../lib/project-files.mjs';
import {resolveStoragePath,getStorageRoot} from '../../lib/storage-paths.mjs';
import {withLocalStateLock} from '../../lib/atomic-local-state.mjs';
import {createClipFromCandidate} from './ClipService.mjs';
import {JobStore} from '../JobStore.mjs';
import path from 'node:path';
export async function requestPrivateRecut(archiveId,{startTime,endTime},{library=new ClipLibraryService(),jobs=new JobStore()}={}){
  const entry=await library.identity(archiveId),start=Number(startTime),end=Number(endTime);
  if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end-start<15||end-start>90)throw recutError('El nuevo recorte debe durar de 15 a 90 segundos.');
  return withLocalStateLock(path.join(getStorageRoot(),'recut-requests',entry.projectId),async()=>{
    const project=await loadProjectFile(entry.projectId);
    if(!project || end>project.source.durationSeconds)throw recutError('Restaura el proyecto original antes de recortar.');
    try {await stat(resolveStoragePath(project.source.relativePath));}catch{throw recutError('Falta recuperar el original desde su respaldo privado. El clip actual se conserva.');}
    if((project.source.capture?.continuityBreaks||[]).some(t=>start<t&&end>t))throw recutError('El recorte cruza un intervalo de captura interrumpido.');
    const candidateId='manual-recut-'+createHash('sha256').update(`${archiveId}/${start}/${end}`).digest('hex').slice(0,24);
    project.analysis ||= {status:'COMPLETED',candidates:[]};project.analysis.candidates ||= [];
    if(!project.analysis.candidates.some(c=>c.id===candidateId)){project.analysis.candidates.push({id:candidateId,startTime:start,endTime:end,duration:end-start,title:entry.title,text:'Recorte solicitado por el propietario.',reason:'Versión solicitada manualmente; revisión pendiente.'});await replaceProjectFile(project.id,project);}
    const {clip}=await createClipFromCandidate(project.id,candidateId,{framingMode:'CONVERSATION',quality:'BALANCED'});
    const job=await jobs.enqueueRender(project.id,clip.id);
    const recut={jobId:job.id,clipId:clip.id,startTime:start,endTime:end,status:job.status,requestedAt:new Date().toISOString()};
    return {clip:await library.setReview(archiveId,'RECUT_REQUESTED',recut),recut};
  });
}

function recutError(message){return Object.assign(new Error(message),{code:'RECUT_INVALID'});}
