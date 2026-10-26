import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,readdir} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import {ProjectRecoveryService,requestProjectRecovery,readProjectRecoveryRequests,processProjectRecoveryRequest} from '../services/storage/ProjectRecoveryService.mjs';
import {MemoryObjectStore} from './helpers/memory-object-store.mjs';

const prefix='clipforge-managed/v1/';
async function fixture(t){
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-project-recovery-')),id=randomUUID(),clipId=randomUUID();
  t.after(()=>rm(root,{recursive:true,force:true}));
  const cloud=new MemoryObjectStore(),source='uploads/'+id+'/source.webm',output='clips/'+id+'/'+clipId+'/render.mp4';
  // Opaque unit data, deliberately not an audiovisual acceptance fixture.
  const project={id,createdAt:'2026-10-26T00:00:00Z',source:{projectId:id,relativePath:source,originalName:'Owned interview.webm',hasAudio:true,sourceUrl:'https://media.example/video?signature=private',headers:{authorization:'unit-secret'}},
    clips:[{id:clipId,projectId:id,candidateId:'manual-test',startTime:10,endTime:40,duration:30,status:'READY',edit:{framingMode:'FIT'},render:{relativePath:output,validation:{valid:true}}}]};
  const job={id:'render-'+id+'-'+clipId,type:'RENDER_CLIP',projectId:id,entityId:clipId,status:'PROCESSING',progress:55,payload:{clipId},createdAt:project.createdAt,history:[]};
  for(const [relative,body]of [[source,'Original immutable unit bytes'],[output,'Completed render unit bytes'],['projects/'+id+'.json',JSON.stringify(project)],['jobs/'+job.id+'.json',JSON.stringify(job)]]){
    const file=path.join(root,relative);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,body);
  }
  let validations=0;
  const service=new ProjectRecoveryService({root,cloud,validate:async()=>{validations++;return{valid:true};}});
  return{root,id,clipId,source,output,project,job,cloud,service,validations:()=>validations};
}
test('ordinary project backup survives an empty filesystem, restores intervals and paused queues without another render',async t=>{
  const f=await fixture(t),saved=await f.service.backup(f.id),count=f.cloud.objects.size;
  const repeat=await f.service.backup(f.id);assert.equal(repeat.reused,true);assert.equal(f.cloud.objects.size,count);
  const snapshot=(await f.cloud.getJson(saved.snapshotKey)).value;assert.equal(snapshot.project.source.headers,undefined);assert.equal(snapshot.project.source.sourceUrl,'https://media.example/video');assert.equal(snapshot.jobs[0].progress,undefined);
  const target=path.join(f.root,'new-instance'),restored=await f.service.restore(f.id,{targetRoot:target});
  assert.equal(restored.outputs,1);assert.equal(restored.jobsPaused,true);assert.equal(f.validations(),1);
  assert.equal(await readFile(path.join(target,f.source),'utf8'),'Original immutable unit bytes');
  assert.equal(await readFile(path.join(target,f.output),'utf8'),'Completed render unit bytes');
  const p=JSON.parse(await readFile(path.join(target,'projects',f.id+'.json'),'utf8'));
  assert.equal(p.clips[0].startTime,10);assert.equal(p.clips[0].endTime,40);assert.equal(p.clips[0].status,'READY');
  const job=JSON.parse(await readFile(path.join(target,'jobs',f.job.id+'.json'),'utf8'));assert.equal(job.status,'COMPLETED');
  assert.equal(f.cloud.deletes.length,0);
  await f.service.restore(f.id,{targetRoot:target}); // idempotent, no conflicting overwrite
});
test('pending manual clips and jobs are recoverable, explicitly paused and never published or auto-enqueued',async t=>{
  const f=await fixture(t);f.project.clips[0].status='QUEUED';f.project.clips[0].render=null;
  await writeFile(path.join(f.root,'projects',f.id+'.json'),JSON.stringify(f.project));
  await f.service.backup(f.id);const target=path.join(f.root,'pending');
  await f.service.restore(f.id,{targetRoot:target});
  const p=JSON.parse(await readFile(path.join(target,'projects',f.id+'.json'),'utf8'));assert.equal(p.clips[0].status,'DRAFT');
  const job=JSON.parse(await readFile(path.join(target,'jobs',f.job.id+'.json'),'utf8'));assert.equal(job.status,'WAITING_RESOURCE');assert.equal(job.progress,0);
  assert.equal((await f.service.list())[0].outputCount,0);
});
test('hash corruption and missing objects fail before any project is made visible; conflicts preserve newer local work',async t=>{
  const f=await fixture(t),saved=await f.service.backup(f.id),object=f.cloud.objects.get(saved.source.key),original=object.body;
  object.body=Buffer.from('Changed unit bytes');
  const target=path.join(f.root,'corrupt');await assert.rejects(f.service.restore(f.id,{targetRoot:target}),e=>e.code==='STORAGE_INTEGRITY');
  await assert.rejects(readFile(path.join(target,'projects',f.id+'.json')),e=>e.code==='ENOENT');
  object.body=original;
  const conflict=path.join(f.root,'conflict'),existing=path.join(conflict,f.output);await mkdir(path.dirname(existing),{recursive:true});await writeFile(existing,'newer work');
  await assert.rejects(f.service.restore(f.id,{targetRoot:conflict}),e=>e.code==='RECOVERY_CONFLICT');
  assert.equal(await readFile(existing,'utf8'),'newer work');
  await assert.rejects(readFile(path.join(conflict,f.source)),e=>e.code==='ENOENT');
});
test('malformed manifests, traversal and symlinks cannot write outside the project root',async t=>{
  const f=await fixture(t),saved=await f.service.backup(f.id);
  await f.cloud.putJson(prefix+'project-recovery/'+f.id+'.json',{...saved,source:{...saved.source,relativePath:'../outside'}});
  await assert.rejects(f.service.restore(f.id,{targetRoot:path.join(f.root,'bad')}),e=>e.code==='RECOVERY_INVALID');
  await f.cloud.putJson(prefix+'project-recovery/'+f.id+'.json',saved);
  const target=path.join(f.root,'symlinks'),outside=path.join(f.root,'outside');await mkdir(target);await mkdir(outside);await symlink(outside,path.join(target,'uploads'));
  await assert.rejects(f.service.restore(f.id,{targetRoot:target}),e=>e.code==='RECOVERY_INVALID');
  assert.deepEqual(await readdir(outside),[]);
});
test('existing source/output objects are reused and storage outage does not replace the last good checkpoint',async t=>{
  const f=await fixture(t),sourceHash=createHash('sha256').update('Original immutable unit bytes').digest('hex');
  const oldKey=prefix+'sources/'+randomUUID()+'/original-'+sourceHash+'.mp4';
  await f.cloud.put(oldKey,Buffer.from('Original immutable unit bytes'),{metadata:{sha256:sourceHash}});
  const saved=await f.service.backup(f.id);assert.equal(saved.source.key,oldKey);
  assert.equal((await f.cloud.list(prefix+'sources/sha256/'+sourceHash)).length,0);
  f.project.clips[0].title='A new manual title';await writeFile(path.join(f.root,'projects',f.id+'.json'),JSON.stringify(f.project));
  f.cloud.failPut=key=>key.includes('/snapshots/');
  await assert.rejects(f.service.backup(f.id));
  assert.equal((await f.cloud.getJson(prefix+'project-recovery/'+f.id+'.json')).value.snapshotHash,saved.snapshotHash);
  assert.equal(f.cloud.deletes.length,0);
});
test('queued recovery requests persist, resume after an interrupted worker and expose safe results',async t=>{
  const f=await fixture(t);
  await requestProjectRecovery(f.id,'BACKUP',{root:f.root});
  let [request]=await readProjectRecoveryRequests(f.root);assert.equal(request.status,'QUEUED');
  const file=path.join(f.root,'project-recovery','requests',f.id+'.json');await writeFile(file,JSON.stringify({...request,status:'PROCESSING'}));
  request=await processProjectRecoveryRequest(request,f.service);assert.equal(request.status,'COMPLETED');assert.equal(request.result.source,undefined);
  assert.equal((await readProjectRecoveryRequests(f.root))[0].status,'COMPLETED');
});
test('reusing a library MP4 protects it for compatibility with older cleanup workers instead of duplicating bytes',async t=>{
  const f=await fixture(t),bytes=Buffer.from('Completed render unit bytes'),sha256=createHash('sha256').update(bytes).digest('hex');
  const id=createHash('sha256').update(f.id+'/'+f.clipId+'/'+sha256).digest('hex'),key=prefix+'media/'+id+'.mp4';
  const stored=await f.cloud.put(key,bytes,{metadata:{sha256}});
  await f.cloud.putJson(prefix+'records/'+id+'.json',{id,managedBy:'clipforge-v1',projectId:f.id,clipId:f.clipId,objectKey:key,
    sha256,sizeBytes:bytes.length,objectEtag:stored.etag,createdAt:'2026-10-26T00:00:00Z',expiresAt:'2026-11-26T00:00:00Z',keep:false,status:'READY'});
  const backup=await f.service.backup(f.id);
  assert.equal(backup.outputs[0].key,key);
  assert.equal((await f.cloud.getJson(prefix+'records/'+id+'.json')).value.keep,true);
  assert.equal((await f.cloud.list(prefix+'sources/sha256/'+sha256)).length,0);
});
test('an unchanged snapshot repairs a missing cloud output instead of reporting a successful but incomplete backup',async t=>{
  const f=await fixture(t),saved=await f.service.backup(f.id),key=saved.outputs[0].key;
  f.cloud.objects.delete(key); // explicit fixture fault, not production deletion
  const repaired=await f.service.backup(f.id);assert.equal(repaired.reused,false);
  assert.ok(await f.cloud.head(key));assert.equal(f.cloud.deletes.length,0);
});
test('derived clip projects restore a shared original at its existing path without duplicating cloud media',async t=>{
  const f=await fixture(t);await f.service.backup(f.id);const before=(await f.cloud.list(prefix+'sources/')).length,derivedId=randomUUID();
  const derived={...f.project,id:derivedId,source:{...f.project.source,projectId:derivedId},clips:[],clipsOrigin:{projectId:f.id}};
  await writeFile(path.join(f.root,'projects',derivedId+'.json'),JSON.stringify(derived));
  const snapshot=await f.service.backup(derivedId);assert.equal(snapshot.source.relativePath,f.source);
  assert.equal((await f.cloud.list(prefix+'sources/')).length,before);
  const target=path.join(f.root,'derived-restored');await f.service.restore(derivedId,{targetRoot:target});
  assert.equal(await readFile(path.join(target,f.source),'utf8'),'Original immutable unit bytes');
  assert.equal(JSON.parse(await readFile(path.join(target,'projects',derivedId+'.json'),'utf8')).clipsOrigin.projectId,f.id);
});
test('backup and ordinary storage archival share one MP4 object even when the backup worker arrives first',async t=>{
  const f=await fixture(t);f.project.clips[0].render.archiveEligible=true;
  await writeFile(path.join(f.root,'projects',f.id+'.json'),JSON.stringify(f.project));
  const snapshot=await f.service.backup(f.id);
  assert.match(snapshot.outputs[0].key,/\/media\/[a-f0-9]{64}\.mp4$/);
  const before=f.cloud.objects.size,saved=await f.service.library.archive(f.project,f.project.clips[0],{root:f.root});
  assert.equal(saved.keep,true);assert.equal(f.cloud.objects.size,before);assert.equal(f.cloud.uploads,1);
  const sha=snapshot.outputs[0].sha256;assert.equal((await f.cloud.list(prefix+'sources/sha256/'+sha)).length,0);
});
test('quota exhaustion preserves the last checkpoint and local original without deleting any media',async t=>{
  const f=await fixture(t),previous=await f.service.backup(f.id);
  f.project.clips[0].title='Pending edit while storage is full';await writeFile(path.join(f.root,'projects',f.id+'.json'),JSON.stringify(f.project));
  f.cloud.objects.set('unrelated-preserved-object',{body:Buffer.from('unit'),size:8_000_000_000,etag:'"full"',metadata:{}});
  await assert.rejects(f.service.backup(f.id),e=>e.code==='STORAGE_QUOTA');
  assert.equal((await f.cloud.getJson(prefix+'project-recovery/'+f.id+'.json')).value.snapshotHash,previous.snapshotHash);
  assert.equal(await readFile(path.join(f.root,f.source),'utf8'),'Original immutable unit bytes');assert.equal(f.cloud.deletes.length,0);
});
test('a mislabeled publishing job cannot enter an editing checkpoint or be re-enqueued by restore',async t=>{
  const f=await fixture(t);
  await writeFile(path.join(f.root,'jobs',f.job.id+'.json'),JSON.stringify({...f.job,type:'PUBLISH_POST'}));
  await assert.rejects(f.service.backup(f.id),e=>e.code==='RECOVERY_INVALID');
  assert.equal((await f.cloud.list(prefix+'project-recovery/')).length,0);assert.equal(f.cloud.uploads,0);
});
test('backup redacts API keys and signed URLs without losing a public YouTube source identifier',async t=>{
  const f=await fixture(t);
  f.project.source.originUrl='https://www.youtube.com/watch?v=abcdefghijk&token=private-signature';
  f.project.source.api_key='unit-secret-key';
  await writeFile(path.join(f.root,'projects',f.id+'.json'),JSON.stringify(f.project));
  const checkpoint=await f.service.backup(f.id),snapshot=(await f.cloud.getJson(checkpoint.snapshotKey)).value;
  assert.equal(snapshot.project.source.originUrl,'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(snapshot.project.source.api_key,undefined);
  assert.equal(JSON.stringify(snapshot).includes('private-signature'),false);
});
