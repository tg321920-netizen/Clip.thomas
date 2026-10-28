// Real authenticated mobile UI/APIs, upload, ingest, heuristic selection,
// optional offline translation, media worker, FFmpeg, SRT and private R2.
// Reuses a REAL cached ASR only after identical source hashes are confirmed.
// This is local QA on authentic NASA footage, not a new streamer deliverable.
import assert from 'node:assert/strict';import path from 'node:path';
import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,open,readFile,writeFile} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';import {chromium} from 'playwright';
import {loadProjectFile,updateProjectFile} from '../lib/project-files.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
import {stopChildProcesses} from '../lib/child-shutdown.mjs';
import {selectSubtitleReviewCue,verifySubtitleFrame} from './verify-subtitle-frame.mjs';
const file=process.argv.find(arg=>arg.startsWith('--source-project='))?.slice(17);
if(!file||!process.argv.includes('--rights-confirmed'))throw new Error('Use --source-project=PATH and --rights-confirmed with genuine authorized cached ASR.');
const cached=JSON.parse(await readFile(file,'utf8'));assert.equal(cached.transcript.status,'COMPLETED');assert.equal(cached.transcript.language,'en');
const source=path.resolve(path.dirname(file),'..',cached.source.relativePath),sourceHash=await hashFile(source);
const parent=path.resolve('artifacts/master-mission-20261028');await mkdir(parent,{recursive:true});
const run=await mkdtemp(path.join(parent,'automatic-mobile-')),root=path.join(run,'storage');process.env.CLIPFORGE_STORAGE_DIR=root;
const port=Number(process.env.CLIPFORGE_TEST_PORT||3192),base=`http://127.0.0.1:${port}`,accessKey=randomBytes(32).toString('hex');
const env={...process.env,PORT:String(port),CLIPFORGE_STORAGE_DIR:root,CLIPFORGE_RUNTIME_HOME:path.join(root,'.runtime-home'),
  CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,
  CLIPFORGE_SESSION_KEY:randomBytes(32).toString('hex'),CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:'',
  CLIPFORGE_PROJECT_BACKUP_ENABLED:'false',CLIPFORGE_MEDIA_STORAGE_PROVIDER:process.env.CLIPFORGE_RUN_R2_TESTS==='true'?'r2':'local',CLIPFORGE_STORAGE_RETENTION_ENABLED:'false',
  CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',
  CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_ANALYSIS_PROVIDER:'heuristic',CLIPFORGE_RENDER_THREADS:'1',CLIPFORGE_MAX_RENDER_PROCESSES:'1'};
const log=await open(path.join(run,'runtime.log'),'w'),server=spawn(process.execPath,['scripts/render-runtime-free.mjs'],{env,stdio:['ignore',log.fd,log.fd]});let browser;
const evidence={checkedAt:new Date().toISOString(),run,apiMocks:false,physicalAndroid:false,publicDeployment:false,paidCalls:0,
  publishing:'OFF',source:'NASA/JFK AUTHENTIC AUTHORIZED FOOTAGE',sourceSha256:sourceHash,asr:'REUSED_REAL_WHISPER_FOR_IDENTICAL_BYTES',newWestcolClips:0};
let stage='START';
try{
  let ready=false;for(let i=0;i<60;i++){assert.equal(server.exitCode,null);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(500);}assert.ok(ready);
  assert.equal((await fetch(base+'/api/projects')).status,401);
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,proxy=proxyUrl?{server:new URL(proxyUrl).origin,bypass:'127.0.0.1,localhost'}:undefined;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox'],proxy});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,proxy});let page=await context.newPage();
  const errors=[];context.on('page',page=>page.on('pageerror',error=>errors.push(error.name)));page.on('pageerror',error=>errors.push(error.name));
  await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.getByRole('button',{name:'CREAR MEJORES CLIPS',exact:true}).click();const form=page.getByRole('region',{name:'CREAR MEJORES CLIPS',exact:true});
  stage='UPLOAD';await form.locator('input[type=file]').setInputFiles(source);await form.getByRole('button',{name:'Subir video',exact:true}).click();
  await form.getByText(/Original guardado:/).waitFor({timeout:90000});
  const projects=await(await context.request.get(base+'/api/projects')).json();
  const uploaded=projects.projects.find(item=>item.source?.originalName===path.basename(source));assert.ok(uploaded?.id);
  const project=await loadProjectFile(uploaded.id);assert.equal(await hashFile(path.join(root,project.source.relativePath)),sourceHash);
  await updateProjectFile(project.id,current=>{current.testOnly=true;current.source.testOnly=true;
    current.transcript={...cached.transcript,projectId:current.id,reusedForIdenticalBytesSha256:sourceHash};});
  await form.getByLabel('Cantidad de clips',{exact:true}).fill('1');await form.getByLabel('Duración aproximada de cada clip en segundos',{exact:true}).fill('30');
  await form.getByLabel('Formato de clips automáticos',{exact:true}).selectOption('16:9');
  await form.getByLabel('Resolución de clips automáticos',{exact:true}).selectOption('720p');
  await form.getByLabel('Calidad de clips automáticos',{exact:true}).selectOption('EFFICIENT');
  await form.getByLabel('Encuadre de clips automáticos',{exact:true}).selectOption('CONVERSATION');
  await form.getByLabel('Subtítulos automáticos',{exact:true}).selectOption('TRANSLATE_ES');
  stage='REAL_WORKER';const post=page.waitForResponse(res=>res.url()===base+'/api/media/jobs'&&res.request().method()==='POST');
  const started=Date.now();await form.getByRole('button',{name:'Crear 1 clip de aprox. 30 s',exact:true}).click();
  const submitted=await(await post).json();assert.ok(submitted.job?.id);await page.close();evidence.tabClosedDuringProcessing=true;
  let job;for(let i=0;i<240;i++){
    job=(await(await context.request.get(base+'/api/media/jobs/'+submitted.job.id)).json()).job;
    if(['FAILED','WAITING_RESOURCE'].includes(job?.status))throw new Error(`Real media worker ${job.status}: ${job.error}`);
    if(job?.status==='READY')break;await delay(1000);
  }
  assert.equal(job?.status,'READY');evidence.processingSeconds=(Date.now()-started)/1000;
  assert.equal(job.result.clips.length,1);const output=job.result.clips[0],saved=await loadProjectFile(job.projectId),clip=saved.clips.find(c=>c.id===output.clipId);
  assert.equal(clip.render.width,1280);assert.equal(clip.render.height,720);assert.equal(clip.edit.quality,'EFFICIENT');
  assert.equal(clip.subtitles.translation.modelId,'Helsinki-NLP/opus-mt-tc-big-en-es');assert.equal(clip.subtitles.reviewStatus,'REVIEW_REQUIRED');
  assert.equal(clip.editorialReview.status,'PENDING');assert.equal(saved.analysis.provider,'transcript-heuristic-v6');
  evidence.projectId=job.projectId;evidence.clipId=clip.id;evidence.newQaMp4=1;evidence.sourceInterval={start:clip.startTime,end:clip.endTime};
  page=await context.newPage();await page.goto(base);const article=page.locator(`article[data-media-job-id="${job.id}"]`);
  stage='PLAYBACK_DOWNLOAD';const player=article.locator(`video[src="${output.sourceUrl}"]`);await player.waitFor();
  await player.evaluate(async el=>{el.muted=true;await el.play();});await delay(500);assert.ok(await player.evaluate(el=>el.currentTime)>.1);await player.evaluate(el=>el.pause());
  const [download]=await Promise.all([page.waitForEvent('download'),article.getByRole('link',{name:'Descargar MP4',exact:true}).click()]);
  const downloaded=path.join(run,'downloaded-automatic-720p.mp4');await download.saveAs(downloaded);
  evidence.validation=await validateMp4(downloaded,{width:1280,height:720,duration:clip.duration,requireAudio:true});
  const outputHash=await hashFile(downloaded);assert.equal(outputHash,clip.render.sha256);evidence.outputSha256=outputHash;
  evidence.subtitleFrame=await verifySubtitleFrame({file:downloaded,cue:selectSubtitleReviewCue(clip.subtitles.cues),width:1280,height:720,output:path.join(run,'translated-subtitle-frame')});
  const [srt]=await Promise.all([page.waitForEvent('download'),article.getByRole('link',{name:'Descargar SRT',exact:true}).click()]);
  const srtPath=path.join(run,'translated-es.srt');await srt.saveAs(srtPath);assert.match(await readFile(srtPath,'utf8'),/-->/);evidence.srtDownload=true;
  await article.getByRole('button',{name:'Revisar cortes y subtítulos',exact:true}).click();
  await article.getByLabel(`Texto del subtítulo ${clip.subtitles.cues[0].id}`,{exact:true}).waitFor();evidence.savedAutomaticCaptionEditor=true;
  // Explicit current revision invalidation proves that history does not offer
  // a 404 download while a saved text awaits its next render. No second encode.
  await updateProjectFile(saved.id,current=>{current.clips[0].status='DRAFT';current.clips[0].render=null;});
  await article.getByText('Esta revisión todavía no tiene un archivo disponible. Abre los cortes y subtítulos para consultar o reintentar el render.',{exact:true}).waitFor({timeout:15000});
  assert.equal(await article.getByRole('link',{name:'Descargar MP4',exact:true}).count(),0);evidence.obsoleteDownloadHidden=true;
  await updateProjectFile(saved.id,current=>{current.clips[0].status='READY';current.clips[0].render=clip.render;});
  if(process.env.CLIPFORGE_RUN_R2_TESTS==='true'){
    stage='R2';const library=new ClipLibraryService(),archive=await library.archive(saved,clip,{root});
    const access=await context.request.post(`${base}/api/media/library/${archive.id}/access`);assert.equal(access.status(),200);
    const signed=await access.json();const cloud=await context.request.get(signed.url);assert.equal(cloud.status(),200);
    const privatePath=path.join(run,'private-r2.mp4');await writeFile(privatePath,await cloud.body());assert.equal(await hashFile(privatePath),outputHash);
    const recovery=new ProjectRecoveryService({root});await recovery.backup(saved.id);const restored=await mkdtemp(path.join(run,'restored-'));await recovery.restore(saved.id,{targetRoot:restored});
    assert.equal(await hashFile(path.join(restored,clip.render.relativePath)),outputHash);
    const recovered=JSON.parse(await readFile(path.join(restored,'projects',saved.id+'.json'),'utf8'));
    assert.deepEqual(recovered.clips[0].subtitles,clip.subtitles);
    evidence.r2={archiveId:archive.id,renewedPrivateDownload:true,downloadHashMatched:true,isolatedRestoreHashMatched:true,translatedTrackRestored:true,qaOnly:true};
  }
  assert.equal(await hashFile(source),sourceHash);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(run,'mobile.png'),fullPage:true});evidence.passed=true;
}catch(error){evidence.passed=false;evidence.stage=stage;evidence.diagnostic=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu,'[URL_REDACTED]').slice(0,350);process.exitCode=1;}
finally{await browser?.close();await stopChildProcesses([server],{graceMs:12000});await log.close();await writeFile(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
