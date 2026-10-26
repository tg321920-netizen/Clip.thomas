import path from 'node:path';
import {createReadStream} from 'node:fs';
import {mkdir,readFile,readdir,stat,realpath,link,rm,writeFile,statfs} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {R2ObjectStore,readR2Config,storageError} from './R2ObjectStore.mjs';
import {ClipLibraryService} from './ClipLibraryService.mjs';
import {getStorageRoot} from '../../lib/storage-paths.mjs';
import {isProjectId} from '../../lib/project-id.mjs';
import {withLocalStateLock,writeAtomicJson} from '../../lib/atomic-local-state.mjs';
import {validateMp4} from '../media-processing/MediaValidationService.mjs';

const PREFIX='clipforge-managed/v1/';
const INDEX=PREFIX+'project-recovery/';
const LIMIT=1_900_000;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>{throw storageError(code,message);};
const validHash=value=>/^[a-f0-9]{64}$/.test(value);
const safeId=id=>{if(!isProjectId(id))fail('RECOVERY_INVALID','Identificador de proyecto inválido.');};
const receiptPath=(root,id)=>path.join(root,'project-recovery','receipts',id+'.json');
const BASIC_JOBS={TRANSCRIBE_VIDEO:'transcribe',ANALYZE_VIDEO:'analyze'};

export function projectRecoveryEnabled(env=process.env){
  return env.CLIPFORGE_PROJECT_BACKUP_ENABLED==='true' && Boolean(readR2Config(env));
}
// No credentials, signed query strings, process leases or publishing jobs enter
// a checkpoint. The LIVE archive cannot restore ordinary upload/render queues.
function sanitized(value,key=''){
  if(/token|secret|password|authorization|cookie|headers|access.?key/i.test(key))return undefined;
  if(Array.isArray(value))return value.map(v=>sanitized(v));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value)
    .map(([k,v])=>[k,sanitized(v,k)]).filter(([,v])=>v!==undefined));
  if(typeof value==='string'&&/^https?:\/\//i.test(value)){
    try{const url=new URL(value);url.username='';url.password='';url.search='';url.hash='';return url.toString();}catch{return undefined;}
  }
  return value;
}
async function readJson(file){const bytes=await readFile(file);if(bytes.length>LIMIT)fail('RECOVERY_LIMIT','Los metadatos superan el límite seguro.');return JSON.parse(bytes);}
async function optionalJson(file){try{return await readJson(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function within(root,relative){
  const file=path.resolve(root,relative);
  if(!file.startsWith(path.resolve(root)+path.sep)||relative.includes('\\'))fail('RECOVERY_INVALID','Ruta de recuperación inválida.');
  return file;
}
async function safeParent(root,file){
  const base=await realpath(root);let ancestor=path.dirname(file);
  for(;;){
    try{const resolved=await realpath(ancestor);if(resolved!==base&&!resolved.startsWith(base+path.sep))fail('RECOVERY_INVALID','Ruta de recuperación inválida.');break;}
    catch(error){if(error.code!=='ENOENT')throw error;const parent=path.dirname(ancestor);if(parent===ancestor)throw error;ancestor=parent;}
  }
  await mkdir(path.dirname(file),{recursive:true});
  const resolved=await realpath(path.dirname(file));if(!resolved.startsWith(base+path.sep))fail('RECOVERY_INVALID','Ruta de recuperación inválida.');
}
async function fileProof(root,relative){
  const file=within(root,relative),resolved=await realpath(file),base=await realpath(root);
  if(!resolved.startsWith(base+path.sep))fail('RECOVERY_INVALID','El archivo sale del almacenamiento autorizado.');
  const before=await stat(file);
  if(!before.isFile()||before.size<=0||before.size>1024**3)fail('RECOVERY_LIMIT','El archivo supera el límite de respaldo de 1 GiB.');
  const sha=createHash('sha256'),md5=createHash('md5');
  for await(const bytes of createReadStream(file)){sha.update(bytes);md5.update(bytes);}
  const after=await stat(file);
  if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ino!==after.ino)fail('RECOVERY_SOURCE_CHANGED','El archivo cambió durante el respaldo; se conserva para reintentar.');
  return {relativePath:relative,sha256:sha.digest('hex'),md5:md5.digest('base64'),sizeBytes:before.size};
}
function allowedSource(id,relative){return typeof relative==='string'&&new RegExp('^uploads/'+id+'/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*\\.(mp4|mov|webm)$','i').test(relative);}
function snapshotOf(project,jobs){
  const value=sanitized(project);
  delete value.recovery;
  // Progress/heartbeat changes must not create a new checkpoint every poll.
  for(const job of jobs){delete job.updatedAt;delete job.startedAt;delete job.progress;delete job.error;delete job.history;}
  return {version:1,project:value,jobs:sanitized(jobs)};
}
function validSnapshot(snapshot,id){
  if(snapshot?.version!==1||snapshot.project?.id!==id||!allowedSource(id,snapshot.project.source?.relativePath)||
     !Array.isArray(snapshot.jobs)||snapshot.jobs.length>100||!Array.isArray(snapshot.project.clips||[])||(snapshot.project.clips||[]).length>100)
    fail('RECOVERY_INVALID','El checkpoint no corresponde a un proyecto recuperable.');
  for(const clip of snapshot.project.clips||[])if(!isProjectId(clip.id)||clip.projectId!==id)fail('RECOVERY_INVALID','Clip de otro proyecto en el respaldo.');
  for(const job of snapshot.jobs){
    const render=job.type==='RENDER_CLIP'&&isProjectId(job.entityId)&&job.id==='render-'+id+'-'+job.entityId&&
      (snapshot.project.clips||[]).some(c=>c.id===job.entityId);
    const basic=Object.hasOwn(BASIC_JOBS,job.type)&&job.id===BASIC_JOBS[job.type]+'-'+id;
    if(job.projectId!==id||(!render&&!basic))fail('RECOVERY_INVALID','La cola de recuperación no es válida.');
  }
}

/** Opt-in backup of ordinary projects. Uses the existing private object store,
 * bucket-wide writer lease, quota and immutable hashes; never deletes originals.
 * Recovery publishes paused jobs, not automatic external/model operations. */
export class ProjectRecoveryService{
  constructor({root=getStorageRoot(),cloud,library,validate=validateMp4}={}){
    this.root=path.resolve(root);this.cloud=cloud||new R2ObjectStore();
    this.library=library||new ClipLibraryService({store:this.cloud});this.validate=validate;
  }
  async backup(id){
    safeId(id);
    return withLocalStateLock(path.join(this.root,'project-recovery',id),async()=>{
      const project=await readJson(path.join(this.root,'projects',id+'.json'));
      const jobs=[];
      for(const name of Object.values(BASIC_JOBS)){
        const job=await optionalJson(path.join(this.root,'jobs',name+'-'+id+'.json'));if(job)jobs.push(job);
      }
      for(const clip of project.clips||[]){
        const job=await optionalJson(path.join(this.root,'jobs','render-'+id+'-'+clip.id+'.json'));
        if(job)jobs.push(job);
      }
      const snapshot=snapshotOf(project,jobs);validSnapshot(snapshot,id);
      const snapshotBytes=Buffer.from(JSON.stringify(snapshot));
      if(snapshotBytes.length>LIMIT)fail('RECOVERY_LIMIT','El checkpoint supera el límite seguro.');
      const snapshotHash=digest(snapshotBytes),previous=await this.cloud.getJson(INDEX+id+'.json');
      // All project changes, including intervals and render results, contribute.
      const sourceInfo=await stat(within(this.root,project.source.relativePath));
      const fingerprint=[sourceInfo.dev,sourceInfo.ino,sourceInfo.size,sourceInfo.mtimeMs].join('/');
      const receipt=await optionalJson(receiptPath(this.root,id));
      if(previous?.value?.snapshotHash===snapshotHash&&receipt?.sourceFingerprint===fingerprint&&receipt.snapshotHash===snapshotHash){
        const source=await this.cloud.head(previous.value.source.key);
        if(source?.size===previous.value.source.sizeBytes&&source.metadata?.sha256===previous.value.source.sha256)return {...previous.value,reused:true};
      }
      const source=await fileProof(this.root,project.source.relativePath);
      const files=[source];
      // Reuse original LIVE/VOD backups already preserved by LiveArchiveService.
      source.key=PREFIX+'sources/sha256/'+source.sha256;
      if(!await this.cloud.head(source.key)){
        const originals=(await this.cloud.list(PREFIX+'sources/')).filter(row=>row.key.endsWith('/original-'+source.sha256+'.mp4'));
        for(const row of originals){
          const owner=row.key.slice((PREFIX+'sources/').length).split('/')[0];
          if(!isProjectId(owner))continue;
          const legacy=await this.cloud.head(row.key);
          if(legacy?.size===source.sizeBytes&&legacy.metadata?.sha256===source.sha256){source.key=row.key;break;}
        }
      }
      for(const clip of project.clips||[]){
        if(clip.status!=='READY'||clip.render?.validation?.valid!==true)continue;
        const expected='clips/'+id+'/'+clip.id+'/render.mp4';
        if(clip.render.relativePath!==expected)fail('RECOVERY_INVALID','El resultado no corresponde a este proyecto.');
        const proof=await fileProof(this.root,expected);
        const archiveId=digest(id+'/'+clip.id+'/'+proof.sha256);
        const archiveKey=PREFIX+'media/'+archiveId+'.mp4',archived=await this.cloud.head(archiveKey);
        proof.key=archived?.size===proof.sizeBytes&&archived.metadata?.sha256===proof.sha256?archiveKey:PREFIX+'sources/sha256/'+proof.sha256;
        proof.clipId=clip.id;files.push(proof);
      }
      const manifest={version:1,id,snapshotHash,snapshotKey:INDEX+'snapshots/'+id+'/'+snapshotHash+'.json',
        createdAt:new Date().toISOString(),name:String(project.source.originalName||'Proyecto').slice(0,300),
        source:files[0],outputs:files.slice(1)};
      await this.library.withStorageWriter(async signal=>{
        for(const file of files){
          let remote=await this.cloud.head(file.key,{signal});
          if(!remote){
            await this.library.assertStorageQuota(file.sizeBytes+snapshotBytes.length+8192,signal);
            await this.cloud.put(file.key,createReadStream(within(this.root,file.relativePath)),{length:file.sizeBytes,md5:file.md5,
              metadata:{sha256:file.sha256,managed:'clipforge-project-v1'},ifAbsent:true,signal});
            remote=await this.cloud.head(file.key,{signal});
          }
          if(remote?.size!==file.sizeBytes||remote.metadata?.sha256!==file.sha256)fail('STORAGE_INTEGRITY','No se confirmó la integridad del respaldo.');
        }
        await this.library.assertStorageQuota(snapshotBytes.length+8192,signal);
        const existing=await this.cloud.getJson(manifest.snapshotKey,{signal});
        if(existing&&digest(Buffer.from(JSON.stringify(existing.value)))!==snapshotHash)fail('STORAGE_INTEGRITY','El checkpoint remoto cambió.');
        if(!existing)await this.cloud.putJson(manifest.snapshotKey,snapshot,{ifAbsent:true,signal});
        // CAS prevents an older competing snapshot from replacing a newer one.
        await this.cloud.putJson(INDEX+id+'.json',manifest,previous?{ifMatch:previous.etag,signal}:{ifAbsent:true,signal});
      });
      await writeAtomicJson(receiptPath(this.root,id),{status:'BACKED_UP',snapshotHash,sourceFingerprint:fingerprint,savedAt:manifest.createdAt});
      return {...manifest,reused:false};
    },{timeoutMs:1000});
  }
  async list(){
    const keys=(await this.cloud.list(INDEX)).filter(row=>new RegExp('^'+INDEX+'[a-f0-9-]{36}\\.json$').test(row.key));
    if(keys.length>200)fail('RECOVERY_LIMIT','Hay demasiados proyectos para una consulta única.');
    const result=[];
    for(const row of keys){const entry=await this.cloud.getJson(row.key);const m=entry?.value;if(!isProjectId(m?.id)||row.key!==INDEX+m.id+'.json'||!validHash(m.snapshotHash))fail('RECOVERY_INVALID','Índice de recuperación inválido.');
      result.push({id:m.id,name:m.name,savedAt:m.createdAt,sizeBytes:m.source?.sizeBytes,outputCount:m.outputs?.length||0});}
    return result.sort((a,b)=>b.savedAt.localeCompare(a.savedAt));
  }
  async restore(id,{targetRoot=this.root,maxBytes=2*1024**3}={}){
    safeId(id);targetRoot=path.resolve(targetRoot);await mkdir(targetRoot,{recursive:true});
    return withLocalStateLock(path.join(targetRoot,'project-recovery',id),async()=>{
      const remote=await this.cloud.getJson(INDEX+id+'.json'),m=remote?.value;
      if(m?.version!==1||m.id!==id||!validHash(m.snapshotHash)||m.snapshotKey!==INDEX+'snapshots/'+id+'/'+m.snapshotHash+'.json'||!Array.isArray(m.outputs)||m.outputs.length>100)fail('RECOVERY_INVALID','No hay un respaldo válido del proyecto.');
      const saved=await this.cloud.getJson(m.snapshotKey);
      if(!saved||digest(Buffer.from(JSON.stringify(saved.value)))!==m.snapshotHash)fail('STORAGE_INTEGRITY','El SHA-256 del checkpoint no coincide.');
      const snapshot=saved.value;validSnapshot(snapshot,id);
      const files=[m.source,...m.outputs],seen=new Set();let total=0;
      for(const file of files){
        const isSource=file===m.source,clip=snapshot.project.clips?.find(c=>c.id===file.clipId);
        const expected=isSource?snapshot.project.source.relativePath:'clips/'+id+'/'+file.clipId+'/render.mp4';
        const sourceOwner=String(file.key).slice((PREFIX+'sources/').length).split('/')[0];
        const legacy=isSource&&isProjectId(sourceOwner)?PREFIX+'sources/'+sourceOwner+'/original-'+file.sha256+'.mp4':PREFIX+'media/'+digest(id+'/'+file.clipId+'/'+file.sha256)+'.mp4';
        if(!validHash(file.sha256)||!Number.isSafeInteger(file.sizeBytes)||file.sizeBytes<=0||file.relativePath!==expected||seen.has(expected)||
          (!isSource&&(!clip||clip.status!=='READY'||clip.render?.relativePath!==expected))||
          ![PREFIX+'sources/sha256/'+file.sha256,legacy].includes(file.key))fail('RECOVERY_INVALID','Ruta o huella inválida en el respaldo.');
        seen.add(expected);total+=file.sizeBytes;
      }
      if(total>maxBytes||total>2*1024**3)fail('RECOVERY_LIMIT','El proyecto supera el cupo de recuperación.');
      const space=await statfs(targetRoot);
      if(space.bavail*space.bsize<total+128*1024**2)fail('RECOVERY_DISK_FULL','No hay espacio suficiente para recuperar el proyecto.');
      const stage=path.join(targetRoot,'.project-restore-'+randomUUID());await mkdir(stage);
      try{
        for(const file of files){
          const object=await this.cloud.get(file.key);if(!object)fail('STORAGE_NOT_FOUND','Falta un archivo del respaldo.');
          const target=within(stage,file.relativePath);await mkdir(path.dirname(target),{recursive:true});
          // Streaming to disk, bounded by the declared size, never RAM-sized video.
          const {open}=await import('node:fs/promises');const handle=await open(target,'wx',0o600);const hash=createHash('sha256');let bytes=0;
          try{for await(const chunk of object.body){bytes+=chunk.length;if(bytes>file.sizeBytes)fail('STORAGE_INTEGRITY','El tamaño del respaldo cambió.');hash.update(chunk);await handle.writeFile(chunk);}}
          finally{await handle.close();object.body.destroy?.();}
          if(bytes!==file.sizeBytes||hash.digest('hex')!==file.sha256)fail('STORAGE_INTEGRITY','El SHA-256 del archivo recuperado no coincide.');
          if(file!==m.source)await this.validate(target,{requireAudio:snapshot.project.source.hasAudio!==false,duration:snapshot.project.clips.find(c=>c.id===file.clipId).duration});
        }
        const project=snapshot.project;
        for(const key of ['transcript','analysis'])if(['PROCESSING','QUEUED'].includes(project[key]?.status)){
          project[key].status='FAILED';project[key].error='Trabajo recuperado; vuelve a solicitar el análisis o la transcripción.';
        }
        for(const clip of project.clips||[])if(!m.outputs.some(f=>f.clipId===clip.id)&&['READY','RENDERING','QUEUED'].includes(clip.status)){
          clip.status='DRAFT';clip.render=null;clip.error='Recorte recuperado. Pulsa Reintentar para reanudarlo.';
        }
        project.recovery={status:'RESTORED',snapshotHash:m.snapshotHash,restoredAt:m.createdAt,jobsPaused:true};
        const metadata=[{relativePath:'projects/'+id+'.json',value:project}];
        for(const job of snapshot.jobs){
          const ready=job.type==='RENDER_CLIP'?m.outputs.some(f=>f.clipId===job.entityId):
            job.type==='TRANSCRIBE_VIDEO'?project.transcript?.status==='COMPLETED':project.analysis?.status==='COMPLETED';
          metadata.unshift({relativePath:'jobs/'+job.id+'.json',value:{...job,status:ready?'COMPLETED':'WAITING_RESOURCE',stage:ready?'RESTORED_COMPLETE':'RESTORED_PAUSED',progress:ready?100:0,attempts:0,startedAt:null,error:ready?null:'Trabajo recuperado; reanúdalo desde el proyecto.',nextAttemptAt:null}});
        }
        for(const entry of metadata){const file=within(stage,entry.relativePath);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(entry.value,null,2),{flag:'wx'});}
        const publish=[...files,...metadata.map(f=>({relativePath:f.relativePath}))];
        // Check every conflict before publishing anything; never overwrite a
        // newer local project. Metadata is last, jobs are restored paused.
        for(const file of publish){
          const target=within(targetRoot,file.relativePath),present=await stat(target).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
          if(present){const expected=await fileProof(stage,file.relativePath),actual=await fileProof(targetRoot,file.relativePath);
            if(actual.sha256!==expected.sha256)fail('RECOVERY_CONFLICT','Hay archivos locales diferentes; no se sobrescriben.');}
        }
        for(const file of publish){
          const target=within(targetRoot,file.relativePath);await safeParent(targetRoot,target);
          await link(within(stage,file.relativePath),target).catch(async e=>{
            if(e.code!=='EEXIST')throw e;
            const expected=await fileProof(stage,file.relativePath),actual=await fileProof(targetRoot,file.relativePath);
            if(expected.sha256!==actual.sha256)fail('RECOVERY_CONFLICT','El destino cambió durante la recuperación; no se sobrescribe.');
          });
        }
        await writeAtomicJson(receiptPath(targetRoot,id),{status:'RESTORED',snapshotHash:m.snapshotHash,savedAt:m.createdAt,jobsPaused:true});
        return {projectId:id,restoredFiles:files.length,outputs:m.outputs.length,jobsPaused:true,snapshotHash:m.snapshotHash};
      }finally{await rm(stage,{recursive:true,force:true});}
    });
  }
}

export async function requestProjectRecovery(id,action,{root=getStorageRoot()}={}){
  safeId(id);if(!['BACKUP','RESTORE'].includes(action))fail('RECOVERY_INVALID','Operación de recuperación inválida.');
  const file=path.join(root,'project-recovery','requests',id+'.json');
  return withLocalStateLock(file,async()=>{
    const current=await optionalJson(file);
    if(['QUEUED','PROCESSING'].includes(current?.status))return current;
    const request={projectId:id,action,status:'QUEUED',createdAt:new Date().toISOString()};
    await writeAtomicJson(file,request);return request;
  });
}
export async function readProjectRecoveryRequests(root=getStorageRoot()){
  const folder=path.join(root,'project-recovery','requests'),names=await readdir(folder).catch(e=>{if(e.code==='ENOENT')return [];throw e;});
  return Promise.all(names.filter(n=>isProjectId(n.slice(0,-5))&&n.endsWith('.json')).slice(0,200).map(n=>readJson(path.join(folder,n))));
}
export async function processProjectRecoveryRequest(request,service){
  const file=path.join(service.root,'project-recovery','requests',request.projectId+'.json');
  return withLocalStateLock(file,async()=>{
    const current=await readJson(file);if(!['QUEUED','PROCESSING'].includes(current.status))return current;
    await writeAtomicJson(file,{...current,status:'PROCESSING'});
    try{const result=current.action==='BACKUP'?await service.backup(current.projectId):await service.restore(current.projectId);
      const done={...current,status:'COMPLETED',result,completedAt:new Date().toISOString()};
      // Do not expose private object keys or full checkpoint metadata via API.
      delete done.result.source;delete done.result.outputs;delete done.result.snapshotKey;
      await writeAtomicJson(file,done);return done;
    }catch(error){const failed={...current,status:'FAILED',errorCode:error.code||'RECOVERY_FAILED',error:'No se completó la recuperación. Los archivos existentes se conservaron.',completedAt:new Date().toISOString()};await writeAtomicJson(file,failed);return failed;}
  },{timeoutMs:1000,staleMs:0});
}
