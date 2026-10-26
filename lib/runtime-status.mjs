import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {getStorageRoot} from './storage-paths.mjs';
import {writeAtomicJson} from './atomic-local-state.mjs';
import {leaseOwner,ownerIsAlive} from './process-lease.mjs';

/** Single-host evidence of the actual scheduler, separate from an enable flag. */
export async function saveRuntimeStatus(status,{root=getStorageRoot(),now=Date.now}={}){
  await writeAtomicJson(path.join(root,'runtime-status.json'),{version:1,owner:leaseOwner(),...status,checkedAt:new Date(now()).toISOString()});
}
export async function readRuntimeStatus({root=getStorageRoot(),now=Date.now,isAlive=ownerIsAlive}={}){
  try{
    const bytes=await readFile(/* turbopackIgnore: true */ path.join(root,'runtime-status.json'));if(bytes.length>10000)throw new Error('Invalid runtime state');
    const record=JSON.parse(bytes),age=now()-Date.parse(record.checkedAt);
    const running=record.version===1&&record.status==='RUNNING'&&Number.isFinite(age)&&age>=0&&age<=30000&&isAlive(record.owner);
    return {running,status:running?'RUNNING':record.status==='STOPPED'?'STOPPED':'NOT_RUNNING',checkedAt:record.checkedAt||null,profile:['stable','development'].includes(record.profile)?record.profile:null};
  }catch{return {running:false,status:'UNVERIFIED',checkedAt:null,profile:null};}
}
