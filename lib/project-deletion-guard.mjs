import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {getStorageRoot} from './storage-paths.mjs';
import {isProjectId} from './project-id.mjs';

/** Do not remove a shared original or the input of an unfinished worker. */
export async function assertProjectDeletionSafe(projectId,{root=getStorageRoot()}={}) {
  if(!isProjectId(projectId))throw new Error('Identificador de proyecto inválido.');
  const fail=message=>{throw Object.assign(new Error(message),{code:'PROJECT_IN_USE'});};
  const list=async directory=>readdir(path.join(root,directory)).catch(error=>{if(error.code==='ENOENT')return[];throw error;});
  const read=async file=>{
    try{
      // Long project transcripts use the same 16 MiB ceiling as recovery.
      // Bound the read before allocating and verify again after reading.
      const limit=16*1024**2,info=await stat(file);if(!info.isFile()||info.size>limit)throw new Error();
      const bytes=await readFile(file);if(bytes.length>limit)throw new Error();return JSON.parse(bytes);
    }
    catch(error){if(error.code==='ENOENT')return null;fail('No se pudo comprobar una referencia del proyecto. Se conservan los archivos.');}
  };
  for(const name of await list('projects')) {
    if(!name.endsWith('.json')||name===projectId+'.json')continue;
    const project=await read(path.join(root,'projects',name));
    const relative=project?.source?.relativePath;
    if(typeof relative==='string'&&['uploads','clips','transcripts','news'].some(folder=>relative.startsWith(`${folder}/${projectId}/`))) {
      fail('Este original todavía lo utiliza otro proyecto. Se conservó para no romper sus clips.');
    }
  }
  for(const directory of ['jobs','ingest-jobs'])for(const name of await list(directory)) {
    if(!name.endsWith('.json'))continue;
    const job=await read(path.join(root,directory,name));
    if(job&&(job.projectId===projectId||job.payload?.projectId===projectId||job.result?.projectId===projectId||job.source?.relativePath?.startsWith(`uploads/${projectId}/`))&&['QUEUED','PROCESSING','VALIDATING','WAITING_RESOURCE'].includes(job.status)) {
      fail('Hay trabajos que necesitan este proyecto. Termínalos o cancélalos antes de eliminar sus archivos.');
    }
  }
}
