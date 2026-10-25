// Real local HTTP, orchestration, worker, frame extraction, FFmpeg and MP4 checks.
// AI replies are explicit fixtures: this does NOT measure any model's editorial quality.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { AgentRuntimeService } from '../services/agent/AgentRuntimeService.mjs';
import { JobStore } from '../services/JobStore.mjs';
import { loadProjectFile, replaceProjectFile } from '../lib/project-files.mjs';
import { BestClipsService } from '../services/analysis/BestClipsService.mjs';
import { validateMp4 } from '../services/media-processing/MediaValidationService.mjs';
import { AIUsageService } from '../services/usage/AIUsageService.mjs';
import { recoverMediaResult } from '../services/media-processing/MediaResultRecovery.mjs';

function run(command,args,env=process.env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{env,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(`E2E child exited ${code}`)));});}
const fixtureRoot=path.resolve('artifacts/live-clipping');
try { await readFile(path.join(fixtureRoot,'evidence.json')); }
catch { await run(process.execPath,['scripts/live-clipping-e2e.mjs'],{...process.env,CLIPFORGE_MEDIA_STORAGE_PROVIDER:'local',CLIPFORGE_ANALYSIS_PROVIDER:'heuristic'}); }
const fixture=JSON.parse(await readFile(path.join(fixtureRoot,'evidence.json'),'utf8'));
const rendered=JSON.parse(await readFile(path.join(fixtureRoot,'storage/projects',`${fixture.result.projectId}.json`),'utf8'));
const original=JSON.parse(await readFile(path.join(fixtureRoot,'storage/projects',`${rendered.clipsOrigin.projectId}.json`),'utf8'));
assert.equal(original.transcript.status,'COMPLETED');assert.match(original.transcript.provider,/whisper/);
const directory=path.resolve('artifacts/editor-agent',`run-${randomUUID()}`);
process.env.CLIPFORGE_STORAGE_DIR=path.join(directory,'storage');
process.env.CLIPFORGE_MEDIA_STORAGE_PROVIDER='local';
process.env.CLIPFORGE_MEDIA_WIDTH='360';process.env.CLIPFORGE_MEDIA_HEIGHT='640';
for(const key of ['CLIPFORGE_AGENT_REAL_PUBLISHING','CLIPFORGE_CONTENT_REAL_PUBLISHING','CLIPFORGE_SMART_PUBLISH_ON_BOOT'])process.env[key]='false';
delete process.env.CLIPFORGE_REDIS_URL;delete process.env.REDIS_URL;
const projectId=randomUUID();
const relative=path.posix.join('uploads',projectId,'source.mp4');
await mkdir(path.dirname(path.join(process.env.CLIPFORGE_STORAGE_DIR,relative)),{recursive:true});
await copyFile(path.join(fixtureRoot,'storage',original.source.relativePath),path.join(process.env.CLIPFORGE_STORAGE_DIR,relative));
await replaceProjectFile(projectId,{...original,id:projectId,source:{...original.source,projectId,relativePath:relative},clips:[],analysis:null});
let decisions=0,rankings=0,visualRequests=0,totalFrames=0;
const server=createServer(async(request,response)=>{
  try {
    assert.equal(request.method,'POST');assert.equal(request.url,'/v1/chat/completions');
    const chunks=[];let bytes=0;for await(const chunk of request){bytes+=chunk.length;assert.ok(bytes<2_500_000);chunks.push(chunk);}
    const body=JSON.parse(Buffer.concat(chunks));assert.equal(body.model,'local-editor-fixture');
    const content=body.messages[1].content;const input=JSON.parse(typeof content==='string'?content:content[0].text);
    let output;
    if(input.task && input.context){
      decisions++;output=decisions===1?{type:'TOOL',tool:'clips.prepare',input:{},output:{},reason:null,rationale:'Use approved existing project'}:{type:'COMPLETE',tool:null,input:{},output:{status:'READY'},reason:null,rationale:'Job queued'};
    }else{
      rankings++;const selected=[];
      for(const candidate of [...input.candidates].sort((a,b)=>a.startTime-b.startTime)){
        if(selected.some(other=>Math.min(other.endTime,candidate.endTime)>Math.max(other.startTime,candidate.startTime)))continue;
        selected.push(candidate);if(selected.length===2)break;
      }
      assert.equal(selected.length,2);
      if(Array.isArray(content)){visualRequests++;const images=content.filter(item=>item.type==='image_url');totalFrames+=images.length;assert.equal(images.length,input.visualFrames.length);assert.ok(images.length>0&&images.length<=24);assert.ok(images.every(image=>image.image_url.url.startsWith('data:image/jpeg;base64,/9j/')));}
      output={selections:selected.map(c=>({candidateId:c.candidateId,title:'Prueba local del editor',hook:'Una idea completa',reason:'Fixture explícito de integración; requiere evaluación editorial con un modelo real.',relevanceScore:75,qualityFlags:[]}))};
    }
    response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}],usage:{prompt_tokens:100,completion_tokens:50}}));
  }catch(error){response.writeHead(500,{'Content-Type':'application/json'});response.end(JSON.stringify({error:{message:error.message}}));}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const address=server.address();
Object.assign(process.env,{CLIPFORGE_AGENT_PROVIDER:'zai',CLIPFORGE_ZAI_API_KEY:'fixture-local-only',CLIPFORGE_ZAI_MODEL:'local-editor-fixture',CLIPFORGE_EDITOR_MODEL:'local-editor-fixture',CLIPFORGE_ZAI_BASE_URL:`http://127.0.0.1:${address.port}/v1`,CLIPFORGE_EDITOR_VISION:'true',NO_PROXY:[process.env.NO_PROXY,'127.0.0.1','localhost'].filter(Boolean).join(',')});
try{
  const runtime=new AgentRuntimeService();
  const task=await runtime.createTask({objective:'Prepare up to five clips for review with clips.prepare and report the job.',autonomyMode:'SEMI_AUTO',projectId,context:{clipping:{count:5,duration:30,rightsConfirmed:true,contentProfile:'PODCAST'}}});
  const execution=await runtime.runExecution(task.id);assert.equal(execution.status,'COMPLETED');
  const queued=execution.results.find(item=>item.tool==='clips.prepare').result;assert.equal(queued.status,'QUEUED');
  await run(process.execPath,['scripts/media-worker.mjs','--once']);
  const job=await new JobStore().get(queued.jobId);assert.equal(job.status,'READY',job.error);assert.equal(job.result.clips.length,2);
  assert.equal(job.result.requestedCount,5);assert.equal(job.result.actualCount,2);assert.match(job.result.warnings[0],/2 de 5/);
  for(const clip of job.result.clips){await validateMp4(path.join(process.env.CLIPFORGE_STORAGE_DIR,clip.relativePath),{width:360,height:640,duration:clip.duration,requireAudio:true});assert.ok(clip.aiAssessment.visualFrameTimes.length>0);}
  assert.equal(decisions,2);assert.equal(rankings,2);assert.equal(visualRequests,1);
  const saved=await loadProjectFile(job.projectId);const first=saved.clips[0];const firstHash=createHash('sha256').update(await readFile(path.join(process.env.CLIPFORGE_STORAGE_DIR,first.render.relativePath))).digest('hex');
  await replaceProjectFile(job.projectId,{...saved,clips:[first]});
  assert.equal(await recoverMediaResult({...saved,clips:[first]},job),null,'an interrupted subset cannot be delivered as a completed shortfall');
  const resumed=await new BestClipsService().render(job.projectId,job.payload);
  assert.equal(resumed.clips.length,2);assert.equal(rankings,2,'restart must reuse the persisted editorial decision');
  const recovered=await recoverMediaResult(await loadProjectFile(job.projectId),job);
  assert.equal(recovered.actualCount,2);assert.match(recovered.warnings[0],/2 de 5/);
  assert.equal(createHash('sha256').update(await readFile(path.join(process.env.CLIPFORGE_STORAGE_DIR,first.render.relativePath))).digest('hex'),firstHash);
  const usage=await new AIUsageService().list({projectId});assert.equal(usage.length,4);
  const evidence={passed:true,jobId:job.id,projectId:job.projectId,requestedCount:5,actualCount:2,warnings:resumed.warnings,completedShortfallRecovery:true,clips:resumed.clips.map(c=>({duration:c.duration,relativePath:c.relativePath,validation:c.validation})),realLocalHttp:true,realWorker:true,realFfmpeg:true,whisperProvider:original.transcript.provider,rankings,visualRequests,totalFrames,reusedDecisionAfterInterruption:true,publishing:'OFF',scope:'Model decisions are explicit local fixtures. No external AI call or model-quality claim.'};
  await writeFile(path.join(directory,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
}finally{await new Promise(resolve=>server.close(resolve));}
