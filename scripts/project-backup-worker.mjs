import {ProjectRecoveryService,projectRecoveryEnabled,readProjectRecoveryRequests,processProjectRecoveryRequest} from '../services/storage/ProjectRecoveryService.mjs';
import {listProjectFiles} from '../lib/project-files.mjs';
import {writeAtomicJson} from '../lib/atomic-local-state.mjs';
import {getStorageRoot} from '../lib/storage-paths.mjs';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {saveRuntimeStatus} from '../lib/runtime-status.mjs';

if(!projectRecoveryEnabled())process.exit(0);
const once=process.argv.includes('--once'),service=new ProjectRecoveryService();
const pollMs=Math.max(10000,Math.min(60000,Number(process.env.CLIPFORGE_PROJECT_BACKUP_POLL_MS)||15000));
let stopping=false,cursor=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
const heartbeatRoot=path.join(getStorageRoot(),'project-recovery');
await saveRuntimeStatus({status:'RUNNING',profile:'stable'},{root:heartbeatRoot});
const heartbeat=setInterval(()=>void saveRuntimeStatus({status:'RUNNING',profile:'stable'},{root:heartbeatRoot}).catch(()=>{}),5000);heartbeat.unref();
do{
  try{
    for(const request of await readProjectRecoveryRequests()){
      if(stopping)break;
      if(['QUEUED','PROCESSING'].includes(request.status))await processProjectRecoveryRequest(request,service);
    }
    if(!stopping&&process.env.CLIPFORGE_PROJECT_BACKUP_AUTO!=='false'){
      const projects=await listProjectFiles(200),project=projects[cursor++%projects.length];
      if(project){
        const file=path.join(getStorageRoot(),'project-recovery','receipts',project.id+'.json');
        const previous=await readFile(file,'utf8').then(JSON.parse).catch(()=>({}));
        const inputHash=createHash('sha256').update(JSON.stringify(project)).digest('hex');
        const blocked=previous.inputHash===inputHash&&previous.status==='BACKUP_FAILED'&&
          (previous.attempts>=3||Date.parse(previous.nextAttemptAt)>Date.now());
        if(blocked){if(once)break;await new Promise(resolve=>setTimeout(resolve,pollMs));continue;}
        try{await service.backup(project.id);}
        catch(error){const attempts=previous.inputHash===inputHash?Number(previous.attempts||0)+1:1;
          await writeAtomicJson(file,{...previous,status:'BACKUP_FAILED',inputHash,attempts,nextAttemptAt:new Date(Date.now()+Math.min(300000,30000*2**(attempts-1))).toISOString(),
          errorCode:error.code||'BACKUP_FAILED',checkedAt:new Date().toISOString()});}
      }
    }
  }catch(error){console.warn('[project-recovery]',{code:error.code||'RECOVERY_FAILED',message:'Respaldo pendiente; se conservan los archivos locales.'});}
  if(!once&&!stopping)await new Promise(resolve=>setTimeout(resolve,pollMs));
}while(!once&&!stopping);
clearInterval(heartbeat);await saveRuntimeStatus({status:'STOPPED',profile:'stable'},{root:heartbeatRoot});
