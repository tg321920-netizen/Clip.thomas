import path from 'node:path';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
import {R2ObjectStore} from '../services/storage/R2ObjectStore.mjs';
import {probeMediaFile} from '../services/media-processing/MediaValidationService.mjs';

if(process.env.CLIPFORGE_RUN_R2_TESTS!=='true'||!process.argv.includes('--rights-confirmed'))throw new Error('La prueba exige opt-in R2 y una fuente real autorizada. No usa fixtures sintéticos.');
const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
const id=arg('project'),root=arg('source-root'),output=path.resolve(arg('output')||'artifacts/project-recovery/run-'+randomUUID());
if(!id||!root)throw new Error('Indica --project=UUID y --source-root=directorio-existente.');
const cloud=new R2ObjectStore(),writes=[];const put=cloud.put.bind(cloud);
cloud.put=async(key,body,options)=>{writes.push({kind:key.endsWith('.json')?'METADATA':'MEDIA',bytes:options?.length||0});return put(key,body,options);};
const hash=async file=>{const value=createHash('sha256');for await(const bytes of createReadStream(file))value.update(bytes);return value.digest('hex');};
const service=new ProjectRecoveryService({root:path.resolve(root),cloud});
const project=JSON.parse(await readFile(path.join(root,'projects',id+'.json'),'utf8'));
const sourceProbe=await probeMediaFile(path.join(root,project.source.relativePath));
if(!sourceProbe.video)throw new Error('La fuente no contiene vídeo real.');
const checkpoint=await service.backup(id),again=await service.backup(id);
const restoredRoot=path.join(output,'empty-instance');await mkdir(restoredRoot,{recursive:true});
const result=await new ProjectRecoveryService({root:restoredRoot,cloud}).restore(id);
const restored=JSON.parse(await readFile(path.join(restoredRoot,'projects',id+'.json'),'utf8'));
const checks=[];
for(const file of [checkpoint.source,...checkpoint.outputs]){
  const actual=await hash(path.join(restoredRoot,file.relativePath));
  checks.push({kind:file===checkpoint.source?'ORIGINAL':'MP4',sha256:actual,matched:actual===file.sha256,sizeBytes:file.sizeBytes});
}
const evidence={checkedAt:new Date().toISOString(),source:'AUTHORIZED_EXISTING_VIDEO',realR2:true,simulation:'FILESYSTEM_REPLACEMENT_IN_NEW_DIRECTORY',
  projectId:id,outputs:result.outputs,savedIntervals:restored.clips.map(c=>({clipId:c.id,startTime:c.startTime,endTime:c.endTime,status:c.status})),
  restoredRoot,jobsPaused:result.jobsPaused,repeatBackupReused:again.reused,writes,hashChecks:checks,
  newRenders:0,productionRestarted:false,physicalAndroid:false,passed:checks.every(c=>c.matched)&&again.reused===true};
await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
if(!evidence.passed)process.exitCode=1;
