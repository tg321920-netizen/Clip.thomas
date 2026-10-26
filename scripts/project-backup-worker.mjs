import {ProjectRecoveryService,projectRecoveryEnabled,readProjectRecoveryRequests,processProjectRecoveryRequest} from '../services/storage/ProjectRecoveryService.mjs';
import {listProjectFiles} from '../lib/project-files.mjs';
import {writeAtomicJson} from '../lib/atomic-local-state.mjs';
import {getStorageRoot} from '../lib/storage-paths.mjs';
import path from 'node:path';

if(!projectRecoveryEnabled())process.exit(0);
const once=process.argv.includes('--once'),service=new ProjectRecoveryService();
const pollMs=Math.max(10000,Math.min(60000,Number(process.env.CLIPFORGE_PROJECT_BACKUP_POLL_MS)||15000));
let stopping=false,cursor=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
do{
  try{
    for(const request of await readProjectRecoveryRequests()){
      if(stopping)break;
      if(['QUEUED','PROCESSING'].includes(request.status))await processProjectRecoveryRequest(request,service);
    }
    if(!stopping&&process.env.CLIPFORGE_PROJECT_BACKUP_AUTO!=='false'){
      const projects=await listProjectFiles(200),project=projects[cursor++%projects.length];
      if(project){
        try{await service.backup(project.id);}
        catch(error){await writeAtomicJson(path.join(getStorageRoot(),'project-recovery','receipts',project.id+'.json'),
          {status:'BACKUP_FAILED',errorCode:error.code||'BACKUP_FAILED',checkedAt:new Date().toISOString()});}
      }
    }
  }catch(error){console.warn('[project-recovery]',{code:error.code||'RECOVERY_FAILED',message:'Respaldo pendiente; se conservan los archivos locales.'});}
  if(!once&&!stopping)await new Promise(resolve=>setTimeout(resolve,pollMs));
}while(!once&&!stopping);
