import path from 'node:path';
import {withLocalStateLock} from './atomic-local-state.mjs';
import {getStorageRoot} from './storage-paths.mjs';

/** Bounded across independent workers on the same shared local volume. This
 * does not claim to coordinate multiple hosts with independent filesystems. */
export async function withRenderCapacity(operation,{root=getStorageRoot(),env=process.env}={}){
  const count=Number(env.CLIPFORGE_MAX_RENDER_PROCESSES||1),slots=[1,2].includes(count)?count:1;
  for(let slot=0;slot<slots;slot++){
    let entered=false;
    try{return await withLocalStateLock(path.join(root,'render-slots',String(slot)),async()=>{entered=true;return operation();},{timeoutMs:100,staleMs:0});}
    catch(error){if(entered||error.code!=='STATE_BUSY')throw error;}
  }
  throw Object.assign(new Error('El servidor está renderizando otro clip. Este recorte seguirá en la cola.'),{code:'RENDER_CAPACITY_BUSY'});
}
