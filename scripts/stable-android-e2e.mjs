// Actual upload, manual cut, workers, FFmpeg, private R2 and mobile browser.
// Requires existing authorized audiovisual bytes. Never creates synthetic media.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,open,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {loadProjectFile,replaceProjectFile} from '../lib/project-files.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
const video=process.env.CLIPFORGE_TEST_VIDEO;
if(!video||!process.argv.includes('--rights-confirmed'))throw new Error('Provide an authorized actual video and --rights-confirmed. No synthetic fallback.');
if(process.env.CLIPFORGE_MEDIA_STORAGE_PROVIDER==='r2'&&process.env.CLIPFORGE_RUN_R2_TESTS!=='true')throw new Error('R2 acceptance requires CLIPFORGE_RUN_R2_TESTS=true.');
const originalRoot=process.env.CLIPFORGE_STORAGE_DIR||path.resolve('storage');
const sourceHash=await hashFile(video),output=path.resolve('artifacts/stable-android');await mkdir(output,{recursive:true});
const run=await mkdtemp(path.join(output,'run-')),storage=path.join(run,'storage'),port=Number(process.env.CLIPFORGE_TEST_PORT||3164),base=`http://127.0.0.1:${port}`;
const accessKey=randomBytes(32).toString('hex'),sessionKey=randomBytes(32).toString('hex');
const log=await open(path.join(run,'runtime.log'),'w');
const childEnv={...process.env,PORT:String(port),CLIPFORGE_STORAGE_DIR:storage,CLIPFORGE_RUNTIME_HOME:path.join(storage,'.runtime-home'),
 CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,CLIPFORGE_SESSION_KEY:sessionKey,
 CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:'',CLIPFORGE_AGENT_ENABLED:'false',
 CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS:'false',
 CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_STORAGE_PERSISTENT:'false',CLIPFORGE_STORAGE_RETENTION_ENABLED:'false',
 CLIPFORGE_ANALYSIS_PROVIDER:'heuristic',CLIPFORGE_FREE_WORKER_POLL_MS:'1000',CLIPFORGE_MEDIA_WIDTH:'1080',CLIPFORGE_MEDIA_HEIGHT:'1920',
 CLIPFORGE_ZAI_API_KEY:'',ZAI_API_KEY:'',CLIPFORGE_AI_API_KEY:'',OPENAI_API_KEY:'',WHISPER_CPP_COMMAND:'/clipforge-test-no-whisper-for-manual-cuts'};
const runtime=spawn(process.execPath,['scripts/render-runtime-free.mjs'],{detached:true,env:childEnv,stdio:['ignore',log.fd,log.fd]});
let browser,stage='BOOT',evidence={checkedAt:new Date().toISOString(),sourceHash,synthetic:false,physicalAndroid:false,apiMocks:false,publicDeployment:false,storage};
try{
 let health;for(let i=0;i<120;i++){try{const r=await fetch(base+'/api/health');health=await r.json();if(r.ok&&health.processing?.running)break;}catch{}await delay(250);}
 assert.equal(health?.processing?.running,true);assert.equal(health.release.channel,'stable');assert.equal(health.publishing,'OFF');
 assert.equal((await fetch(base+'/api/projects')).status,401);
 browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,acceptDownloads:true});let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 stage='OWNER_LOGIN';await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).click();await page.getByRole('button',{name:'SUBIR Y EDITAR VIDEO',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'CREAR HISTORIA CON IA',exact:true}).count(),0);
 assert.equal(await page.getByRole('region',{name:'Estado de captura de Westcol'}).count(),0);
 assert.equal((await context.request.post(base+'/api/media/jobs',{data:{type:'MEDIA_STORY',payload:{}}})).status(),409);
 stage='REAL_UPLOAD';const form=page.getByRole('region',{name:'SUBIR Y EDITAR VIDEO',exact:true});
 await form.locator('input[type=file]').setInputFiles(video);await form.getByRole('button',{name:'Subir video',exact:true}).click();
 const editor=page.getByRole('region',{name:'Recorte manual',exact:true});await editor.waitFor({timeout:120000});
 const projects=await(await context.request.get(base+'/api/projects')).json();assert.equal(projects.projects.length,1);const projectId=projects.projects[0].id;
 const sourcePlayer=form.locator('video').first();await sourcePlayer.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForFunction(()=>{const v=document.querySelector('#clipforge-upload-panel video');return v&&v.currentTime>0.2&&v.videoWidth>0;});await sourcePlayer.evaluate(v=>v.pause());
 const start=Number(process.env.CLIPFORGE_TEST_START||50),end=start+30;
 await editor.getByLabel('Inicio del fragmento en segundos',{exact:true}).fill(String(start));await editor.getByLabel('Final del fragmento en segundos',{exact:true}).fill(String(end));
 await editor.getByLabel('Tengo autorización para recortar este video.',{exact:true}).check();
 const queuedResponse=page.waitForResponse(r=>r.url()===`${base}/api/projects/${projectId}/clips`&&r.request().method()==='POST');
 await editor.getByRole('button',{name:'Generar MP4 del fragmento',exact:true}).click();const queued=await(await queuedResponse).json();assert.ok(queued.clip?.id);const clipId=queued.clip.id;
 stage='BACKGROUND_RENDER';await page.close();let clip;
 for(let i=0;i<180;i++){const body=await(await context.request.get(`${base}/api/projects/${projectId}/clips`)).json();clip=body.clips?.find(c=>c.id===clipId);if(clip?.status==='FAILED')throw new Error('Real render failed');if(clip?.status==='READY')break;await delay(1000);}
 assert.equal(clip?.status,'READY');process.env.CLIPFORGE_STORAGE_DIR=storage;let project=await loadProjectFile(projectId);assert.equal(project.transcript,undefined,'Manual render must not call Whisper');
 assert.equal(await hashFile(path.join(storage,project.source.relativePath)),sourceHash);
 stage='RETURN_AND_DOWNLOAD';page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByRole('button',{name:'Abrir proyecto',exact:true}).click();
 const result=page.getByRole('region',{name:'Recorte manual'});const player=result.getByLabel('Reproducir recorte manual');await player.waitFor({timeout:30000});await player.evaluate(async v=>{v.muted=true;await v.play();});
 await page.waitForFunction(()=>{const v=document.querySelector('video[aria-label="Reproducir recorte manual"]');return v&&v.currentTime>0.2&&v.videoWidth===1080&&v.videoHeight===1920;});await player.evaluate(v=>v.pause());
 const [download]=await Promise.all([page.waitForEvent('download'),result.getByRole('link',{name:'Descargar recorte MP4',exact:true}).click()]);const downloaded=path.join(run,'manual-downloaded.mp4');await download.saveAs(downloaded);assert.equal(await download.failure(),null);
 const validation=await validateMp4(downloaded,{width:1080,height:1920,duration:30,requireAudio:true}),outputHash=await hashFile(downloaded);
 assert.equal(outputHash,await hashFile(path.join(storage,clip.render.relativePath)));assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(output,'manual-mobile.png'),fullPage:false});
 evidence={...evidence,projectId,clipId,start,end,duration:validation.duration,validation,outputHash,downloaded,ownerLogin:true,originalPlayback:true,outputPlayback:true,tabClosedDuringRender:true,returnedViaProjectHistory:true,manualRequiresWhisper:false,externalAiCalls:0};
 if(process.env.CLIPFORGE_MEDIA_STORAGE_PROVIDER==='r2'){
  stage='PRIVATE_R2';const library=new ClipLibraryService();const saved=await library.archive(project,project.clips.find(c=>c.id===clipId));assert.equal(saved.status,'READY');await library.setKeep(saved.id,true);
  const range=await library.source(saved.id,'bytes=0-63');const chunks=[];for await(const bytes of range.body)chunks.push(bytes);assert.equal(Buffer.concat(chunks).subarray(4,8).toString(),'ftyp');
  await page.getByRole('button',{name:'Actualizar biblioteca',exact:true}).click();const cloudPlayer=page.locator(`video[src="/api/media/library/${saved.id}/source"]`);await cloudPlayer.waitFor({timeout:60000});const article=cloudPlayer.locator('..');
  await article.getByRole('button',{name:'Renovar acceso privado',exact:true}).click();const [cloudDownload]=await Promise.all([page.waitForEvent('download'),article.getByRole('link',{name:'Descargar con enlace temporal',exact:true}).click()]);const cloudFile=path.join(run,'r2-downloaded.mp4');await cloudDownload.saveAs(cloudFile);assert.equal(await hashFile(cloudFile),outputHash);
  evidence={...evidence,archiveId:saved.id,privateR2:true,renewedPrivateDownloadHashMatched:true};
 }
 const cachedId=process.env.CLIPFORGE_TEST_TRANSCRIPT_PROJECT;
 if(cachedId){
  stage='LOCAL_CANDIDATES';process.env.CLIPFORGE_STORAGE_DIR=originalRoot;const cached=await loadProjectFile(cachedId);assert.equal(await hashFile(path.join(originalRoot,cached.source.relativePath)),sourceHash);assert.equal(cached.transcript?.status,'COMPLETED');
  process.env.CLIPFORGE_STORAGE_DIR=storage;project=await loadProjectFile(projectId);project.transcript={...cached.transcript,projectId,derivedFromSourceSha256:sourceHash,reusedForIdenticalSource:true};await replaceProjectFile(projectId,project);
  const response=await context.request.post(`${base}/api/projects/${projectId}/analysis`,{data:{minDuration:20,maxDuration:40,targetDuration:30,maxCandidates:5}});assert.equal(response.status(),202);let analysis;
  for(let i=0;i<120;i++){const state=await(await context.request.get(`${base}/api/projects/${projectId}/analysis`)).json();if(state.analysis?.status==='FAILED')throw new Error('Local candidate analysis failed');analysis=state.analysis;if(analysis?.status==='COMPLETED')break;await delay(1000);}
  assert.equal(analysis?.status,'COMPLETED');assert.equal(analysis.provider,'transcript-heuristic-v6');assert.ok(analysis.candidates.length>0);assert.ok(analysis.candidates.every(c=>Number.isFinite(c.components.audioEnergy)&&Number.isFinite(c.components.visualActivity)));
  evidence={...evidence,candidateCount:analysis.candidates.length,candidateMethod:'LOCAL_HEURISTIC',realTranscriptReusedForIdenticalBytes:true,transcriptProvider:cached.transcript.provider};
 }
 await writeFile(path.join(output,'evidence.json'),JSON.stringify({...evidence,passed:true},null,2));console.log(JSON.stringify({passed:true,projectId,clipId,duration:validation.duration,archiveId:evidence.archiveId,candidateCount:evidence.candidateCount,tabClosedDuringRender:true,physicalAndroid:false,publicDeployment:false}));
}catch(error){await writeFile(path.join(output,'failure.json'),JSON.stringify({stage,code:error.code||error.name,passed:false},null,2));console.error(JSON.stringify({passed:false,stage,code:error.code||error.name,message:stage==='LOCAL_CANDIDATES'?'Local candidate verification did not complete.':'Real mobile acceptance failed; inspect bounded local evidence.'}));process.exitCode=1;}
finally{await browser?.close();runtime.kill('SIGTERM');await Promise.race([once(runtime,'exit'),delay(12000)]);await log.close();process.env.CLIPFORGE_STORAGE_DIR=originalRoot;}
