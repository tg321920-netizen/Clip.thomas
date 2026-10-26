import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, stat } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import path from "node:path";
import { LiveSessionStore } from "./LiveSessionStore.mjs";
import { inspectLiveSegment, enqueueReadyLiveWindows } from "./LiveWindowService.mjs";
import { R2ObjectStore } from "../storage/R2ObjectStore.mjs";
import { ClipLibraryService } from "../storage/ClipLibraryService.mjs";
import { JobStore } from "../JobStore.mjs";
import { IngestJobStore } from "../ingest/IngestJobStore.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { loadProjectFile } from "../../lib/project-files.mjs";
import { hashFile } from "../ingest/ResumableUploadStore.mjs";
import { writeAtomicJson, withLocalStateLock } from "../../lib/atomic-local-state.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { validateMp4 } from "../media-processing/MediaValidationService.mjs";

const PREFIX="clipforge-managed/v1/";
const safeStatePath = file => /^(?:live-monitor\/westcol\.json|live-sessions\/[a-f0-9-]{36}\/(?:session\.json|capture\/\.stream-parts\/capture-clock\.json)|(?:ingest-jobs|live-observations|projects)\/[a-f0-9-]{36}\.json|jobs\/bestclips-[a-f0-9-]{36}\.json|editorial-events\/[a-f0-9]{64}\.json)$/u.test(file);
function destination(root, relative) { const file=path.resolve(root,relative);if(!file.startsWith(path.resolve(root)+path.sep))throw new Error("Ruta de respaldo no válida.");return file; }

/** Private, content-addressed originals and checkpoints. No deletion, public
 * ACL, render request, model call or source re-download is performed here. */
export class LiveArchiveService {
  constructor({root=getStorageRoot(),sessions=new LiveSessionStore({root}),cloud,library,mediaJobs=new JobStore(),ingestJobs=new IngestJobStore()}={}) {
    Object.assign(this,{root,sessions,mediaJobs,ingestJobs});this.cloud=cloud || new R2ObjectStore();this.library=library || new ClipLibraryService({store:this.cloud});
  }
  async archiveOriginalProject(project,source,{validatedSource=null}={}) {
    const id=project?.id;if(!isProjectId(id)||project.source?.relativePath!==`uploads/${id}/source.mp4`)throw new Error("El original no corresponde a su proyecto.");
    await this.sessions.create(id,source);
    const file=destination(this.root,project.source.relativePath),sha256=await hashFile(file),sizeBytes=(await stat(file)).size;
    let validation;
    if(validatedSource){
      const proof=validatedSource.validation;
      if(validatedSource.sha256!==sha256||proof?.sizeBytes!==sizeBytes||proof?.valid!==true||proof?.fullDecode!==true||proof?.videoCodec!=="h264"||proof?.audioCodec!=="aac"||!(proof.duration>0)||!Number.isFinite(Date.parse(proof.checkedAt)))throw Object.assign(new Error("La verificación previa no corresponde a los bytes actuales del original."),{code:"SOURCE_PROOF_MISMATCH"});
      validation=proof;
    }else validation=await validateMp4(file,{requireAudio:true});
    const key=`${PREFIX}sources/${id}/original-${sha256}.mp4`,md5=createHash("md5");for await(const chunk of createReadStream(file))md5.update(chunk);
    await this.library.withStorageWriter(async signal=>{
      let remote=await this.cloud.head(key,{signal});if(!remote){await this.library.assertStorageQuota(sizeBytes+8192,signal);await this.cloud.put(key,createReadStream(file),{length:sizeBytes,type:"video/mp4",md5:md5.digest("base64"),metadata:{sha256,managed:"clipforge-source-v1"},ifAbsent:true,signal});remote=await this.cloud.head(key,{signal});}
      if(remote?.size!==sizeBytes||remote.metadata?.sha256!==sha256)throw new Error("No se confirmó el respaldo del original MP4.");
    });
    const outputs=[];
    for(const clip of project.clips || []){const entry=await this.library.archive(project,clip);if(entry?.status==="READY")outputs.push({id:entry.id,clipId:clip.id,relativePath:clip.render.relativePath,sha256:await hashFile(destination(this.root,clip.render.relativePath)),sizeBytes:entry.sizeBytes});}
    await this.sessions.update(id,s=>{s.originalFiles=[{kind:"MP4_ORIGINAL",relativePath:project.source.relativePath,key,sha256,sizeBytes,validation}];s.originalClipArchives=outputs;s.capture.status="IMPORTED_ORIGINAL";});
    return this.checkpoint(id);
  }
  async archiveSegment(id,index) {
    const session=await this.sessions.get(id), segment=session?.segments.find(s=>s.index===index);
    if(!segment)throw new Error("Falta el segmento original.");
    const file=destination(this.root,segment.relativePath), info=await stat(file);
    if(info.size!==segment.sizeBytes || await hashFile(file)!==segment.sha256)throw new Error("El original cambió; no se archiva una copia inválida.");
    const validation=segment.validation?.valid ? segment.validation : await inspectLiveSegment(file);
    const key=`${PREFIX}sources/${id}/${index}-${segment.sha256}.ts`;
    const md5=createHash("md5");for await(const chunk of createReadStream(file))md5.update(chunk);
    await this.library.withStorageWriter(async signal=>{
      let remote=await this.cloud.head(key,{signal});
      if(!remote){await this.library.assertStorageQuota(info.size+8192,signal);await this.cloud.put(key,createReadStream(file),{length:info.size,type:"video/mp2t",md5:md5.digest("base64"),metadata:{sha256:segment.sha256,managed:"clipforge-source-v1"},ifAbsent:true,signal});remote=await this.cloud.head(key,{signal});}
      if(remote?.size!==info.size || remote.metadata?.sha256!==segment.sha256)throw new Error("R2 no confirmó la integridad del original.");
    });
    await this.sessions.validateSegment(id,index,validation);
    await this.sessions.update(id,s=>{const row=s.segments.find(x=>x.index===index);row.archive={status:"READY",key,sha256:segment.sha256,sizeBytes:info.size,checkedAt:new Date().toISOString()};});
    return key;
  }
  async process(id) {
    let session=await this.sessions.get(id);if(!session)return;
    const next=session.segments.find(s=>s.status==="CAPTURED" && s.archive?.status!=="READY" && Number(s.archive?.attempts || 0)<3 && (!s.archive?.nextAttemptAt || Date.parse(s.archive.nextAttemptAt)<=Date.now()));
    if(next){
      try{await this.archiveSegment(id,next.index);}
      catch(error){await this.sessions.update(id,s=>{const row=s.segments.find(x=>x.index===next.index),attempts=Number(row.archive?.attempts||0)+1;row.archive={status:"FAILED",attempts,errorCode:error.code||"SOURCE_ARCHIVE_FAILED",nextAttemptAt:new Date(Date.now()+Math.min(300000,30000*2**(attempts-1))).toISOString()};});}
    }
    session=await this.sessions.get(id);
    for(const window of session.windows){
      if(!window.clipsJobId || window.status==="ARCHIVED")continue;
      const job=await this.mediaJobs.get(window.clipsJobId);if(job?.status!=="READY")continue;
      const project=await loadProjectFile(job.projectId);if(!project)continue;
      const receipts=[];
      for(const clip of project.clips || []){
        const archived=await this.library.archive(project,clip);
        if(archived?.status!=="READY")throw new Error("El clip aún no tiene archivo privado confirmado.");
        receipts.push({id:archived.id,clipId:clip.id,relativePath:clip.render.relativePath,sha256:await hashFile(destination(this.root,clip.render.relativePath)),sizeBytes:archived.sizeBytes});
      }
      await this.sessions.update(id,s=>{const row=s.windows.find(w=>w.jobId===window.jobId);row.status="ARCHIVED";row.archives=receipts;});
      break;
    }
    // Manual recuts reuse the render worker; archival remains independent and
    // never invokes retention cleanup or deletes an original.
    session=await this.sessions.get(id);
    const projectIds=new Set([...(session.originalFiles?.length?[id]:[]),...session.windows.filter(w=>w.clipsJobId).map(w=>w.clipsJobId)]);
    for(const key of projectIds){
      const projectId=key===id?id:(await this.mediaJobs.get(key))?.projectId;if(!projectId)continue;
      const project=await loadProjectFile(projectId);if(!project)continue;
      for(const clip of project.clips||[]){
        if(clip.status!=="READY" || (session.originalClipArchives||[]).some(o=>o.clipId===clip.id) || session.windows.some(w=>(w.archives||[]).some(o=>o.clipId===clip.id)))continue;
        const saved=await this.library.archive(project,clip);if(saved?.status!=="READY")continue;
        const receipt={id:saved.id,clipId:clip.id,relativePath:clip.render.relativePath,sha256:await hashFile(destination(this.root,clip.render.relativePath)),sizeBytes:saved.sizeBytes};
        await this.sessions.update(id,s=>{s.originalClipArchives||=[];if(!s.originalClipArchives.some(o=>o.clipId===clip.id))s.originalClipArchives.push(receipt);});
      }
    }
    await enqueueReadyLiveWindows(id,{sessions:this.sessions,jobs:this.ingestJobs,mediaJobs:this.mediaJobs});
    return this.checkpoint(id);
  }
  async checkpoint(id) {
    const session=await this.sessions.get(id);if(!session)return;
    const paths=new Set(["live-monitor/westcol.json",`live-sessions/${id}/session.json`,`live-sessions/${id}/capture/.stream-parts/capture-clock.json`,`ingest-jobs/${id}.json`,`live-observations/${id}.json`,`projects/${id}.json`]);
    for(const window of session.windows){paths.add(`ingest-jobs/${window.jobId}.json`);if(window.projectId)paths.add(`projects/${window.projectId}.json`);
      if(window.clipsJobId){paths.add(`jobs/${window.clipsJobId}.json`);const job=await this.mediaJobs.get(window.clipsJobId);if(job?.projectId)paths.add(`projects/${job.projectId}.json`);}}
    const episode=createHash("sha256").update(`${session.source.channelId}/${session.source.sourceId}`).digest("hex");paths.add(`editorial-events/${episode}.json`);
    if(paths.size>256)throw new Error("El checkpoint supera el límite de archivos. Se conserva el último respaldo confirmado.");
    const files=[];let total=0;
    for(const relative of paths){if(!safeStatePath(relative))throw new Error("Ruta de checkpoint no válida.");let bytes;try{bytes=await readFile(destination(this.root,relative));}catch(e){if(e.code==="ENOENT")continue;throw e;}
      total+=bytes.length;if(bytes.length>1_900_000 || total>32_000_000)throw new Error("El checkpoint supera su límite de tamaño.");
      const sha256=createHash("sha256").update(bytes).digest("hex");files.push({relativePath:relative,sha256,sizeBytes:bytes.length,key:`${PREFIX}checkpoints/${id}/state-${sha256}.json`,bytes});}
    const fingerprint=createHash("sha256");
    for(const file of files){
      fingerprint.update(file.relativePath);
      if(file.relativePath===`live-sessions/${id}/session.json`){const snapshot=JSON.parse(file.bytes);delete snapshot.checkpoint;delete snapshot.updatedAt;fingerprint.update(JSON.stringify(snapshot));}
      else fingerprint.update(file.sha256);
    }
    const inputHash=fingerprint.digest("hex");
    if(session.checkpoint?.inputHash===inputHash)return (await this.cloud.getJson(`${PREFIX}checkpoints/${id}/latest.json`))?.value;
    const manifest={version:1,id,createdAt:new Date().toISOString(),files:files.map(file=>({relativePath:file.relativePath,sha256:file.sha256,sizeBytes:file.sizeBytes,key:file.key})),
      sources:[...session.segments.filter(s=>s.archive?.status==="READY").map(s=>({relativePath:s.relativePath,...s.archive})),...(session.originalFiles||[])],
      outputs:[...session.windows.flatMap(w=>w.archives || []),...(session.originalClipArchives||[])].map(o=>({...o,key:`${PREFIX}media/${o.id}.mp4`}))};
    await this.library.withStorageWriter(async signal=>{
      let extra=8192;for(const file of files)if(!await this.cloud.head(file.key,{signal}))extra+=file.sizeBytes;
      await this.library.assertStorageQuota(extra,signal);
      for(const file of files)if(!await this.cloud.head(file.key,{signal}))await this.cloud.put(file.key,file.bytes,{length:file.sizeBytes,type:"application/json",metadata:{sha256:file.sha256},ifAbsent:true,signal});
      const key=`${PREFIX}checkpoints/${id}/latest.json`, previous=await this.cloud.getJson(key,{signal});await this.cloud.putJson(key,manifest,previous?{ifMatch:previous.etag,signal}:{ifAbsent:true,signal});
    });
    await this.sessions.update(id,s=>{s.checkpoint={status:"READY",inputHash,savedAt:manifest.createdAt,sourceCount:manifest.sources.length,metadataFiles:files.length};});return manifest;
  }
  async restore(id,{targetRoot,workersPaused=false,maxBytes=2*1024**3}={}) {
    if(!isProjectId(id)||!workersPaused||!targetRoot)throw new Error("La restauración requiere una sesión válida, destino explícito y workers detenidos.");
    const remote=await this.cloud.getJson(`${PREFIX}checkpoints/${id}/latest.json`), manifest=remote?.value;
    if(manifest?.version!==1||manifest.id!==id||!Array.isArray(manifest.files)||!Array.isArray(manifest.sources)||!Array.isArray(manifest.outputs)||manifest.files.length>256)throw new Error("No hay un checkpoint válido para esa sesión.");
    const entries=[...manifest.sources,...manifest.outputs,...manifest.files];
    const total=entries.reduce((n,e)=>n+Number(e.sizeBytes),0);if(!Number.isFinite(total)||total>maxBytes)throw new Error("El respaldo supera el límite de restauración; no se borran archivos para hacer sitio.");
    await mkdir(targetRoot,{recursive:true});
    const disk=await new LiveSessionStore({root:targetRoot}).capacity({maxBytes:Number.MAX_SAFE_INTEGER,minFreeBytes:total+128*1024**2});if(!disk.allowed)throw new Error("Falta espacio para restaurar.");
    return withLocalStateLock(path.join(targetRoot,"restore-live-state"),async()=>{
      for(const entry of entries){
        const source=manifest.sources.includes(entry), output=manifest.outputs.includes(entry);
        const validSource=source&&((entry.relativePath?.startsWith(`live-sessions/${id}/capture/.stream-parts/part-`)&&/\/part-\d{6}\.ts$/u.test(entry.relativePath)&&entry.key===`${PREFIX}sources/${id}/${Number(/part-(\d+)\.ts$/u.exec(entry.relativePath)[1])}-${entry.sha256}.ts`) || (entry.kind==="MP4_ORIGINAL"&&entry.relativePath===`uploads/${id}/source.mp4`&&entry.key===`${PREFIX}sources/${id}/original-${entry.sha256}.mp4`));
        const validOutput=output&&/^clips\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/render\.mp4$/u.test(entry.relativePath)&&entry.key===`${PREFIX}media/${entry.id}.mp4`;
        const validState=!source&&!output&&safeStatePath(entry.relativePath)&&entry.key===`${PREFIX}checkpoints/${id}/state-${entry.sha256}.json`;
        if(!(validSource||validOutput||validState)||!/^[a-f0-9]{64}$/u.test(entry.sha256))throw new Error("El manifiesto contiene una ruta o huella inválida.");
        const file=destination(targetRoot,entry.relativePath);try{if(await hashFile(file)===entry.sha256)continue;throw new Error("El destino ya contiene datos diferentes; no se sobrescriben.");}catch(error){if(error.code!=="ENOENT")throw error;}
        await mkdir(path.dirname(file),{recursive:true});const temporary=`${file}.restore-${randomUUID()}.part`,object=await this.cloud.get(entry.key);if(!object)throw new Error("Falta un objeto del respaldo.");
        const sha=createHash("sha256");let bytes=0;const check=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;sha.update(chunk);if(bytes>entry.sizeBytes)done(new Error("El respaldo cambió de tamaño."));else done(null,chunk);}});
        await pipeline(object.body,check,createWriteStream(temporary,{flags:"wx",mode:0o600}));
        if(bytes!==entry.sizeBytes||sha.digest("hex")!==entry.sha256)throw new Error("La descarga de respaldo no coincide con su SHA-256. Se conserva para diagnóstico.");
        if(validOutput || entry.kind==="MP4_ORIGINAL")await validateMp4(temporary,{requireAudio:true});
        await rename(temporary,file);
      }
      // Leases are not restored. An interrupted worker must claim the same job
      // again; READY jobs without restored outputs cannot be reported ready.
      for(const entry of manifest.files.filter(e=>/^(?:ingest-jobs|jobs)\//u.test(e.relativePath))){const file=destination(targetRoot,entry.relativePath),job=JSON.parse(await readFile(file,"utf8"));
        if(job.type==="INGEST_LIVE_WINDOW" && job.status==="COMPLETED"){job.status="QUEUED";job.stage="RESTORED_REBUILD_CONTEXT";job.nextAttemptAt=new Date().toISOString();}
        if(["PROCESSING","VALIDATING"].includes(job.status)){job.status="QUEUED";job.stage="RECOVERED";job.nextAttemptAt=new Date().toISOString();}
        if(job.status==="READY" && !(manifest.outputs.length && manifest.outputs.some(o=>o.relativePath.includes(job.projectId)))){job.status="WAITING_RESOURCE";job.stage="RESTORED_WITHOUT_LOCAL_RENDER";job.error="Originales recuperados; falta recuperar o regenerar el render.";}
        await writeAtomicJson(file,job);
      }
      const monitorState=manifest.files.find(e=>e.relativePath==="live-monitor/westcol.json");
      if(monitorState){const file=destination(targetRoot,monitorState.relativePath),monitor=JSON.parse(await readFile(file,"utf8"));monitor.pausedByOwner=true;monitor.status="RESTORED_PAUSED";await writeAtomicJson(file,monitor);}
      const restored=new LiveSessionStore({root:targetRoot});
      await restored.update(id,s=>{
        for(const segment of s.segments)if(!manifest.sources.some(entry=>entry.relativePath===segment.relativePath)){segment.status="MISSING_AFTER_RESTORE";segment.archive={status:"NOT_IN_CHECKPOINT"};}
        const missing=s.segments.filter(segment=>segment.status==="MISSING_AFTER_RESTORE");
        if(missing.length)s.gaps.push({fromUtc:missing[0].sourceStartUtc,toUtc:null,reason:"UNARCHIVED_ORIGINALS_NOT_IN_CHECKPOINT",durationSeconds:null});
        s.capture.status="RESTORED_PAUSED";
      });
      return {sessionId:id,restoredFiles:entries.length,originals:manifest.sources.length,outputs:manifest.outputs.length,workersStarted:false};
    });
  }
}
