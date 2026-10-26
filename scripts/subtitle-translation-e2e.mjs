// Real authorized audiovisual acceptance, not a synthetic streamer fixture.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {mkdir,mkdtemp,open,writeFile,readFile,readdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {loadProjectFile} from '../lib/project-files.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';

if(!process.argv.includes('--rights-confirmed')||!process.env.CLIPFORGE_TEST_VIDEO||!process.env.CLIPFORGE_TEST_SOURCE_URL)throw new Error('An actual authorized video, source URL and --rights-confirmed are required.');
if(!process.env.CLIPFORGE_TRANSLATION_PYTHON||!process.env.CLIPFORGE_TRANSLATION_MODEL_PATH)throw new Error('Configure the offline translation runtime first.');
const cloud=process.env.CLIPFORGE_RUN_R2_TESTS==='true';
const output=path.resolve('artifacts/subtitle-translation');await mkdir(output,{recursive:true});
const resume=process.argv.find(arg=>arg.startsWith('--resume-run='))?.slice('--resume-run='.length);
const run=resume?path.resolve(resume):await mkdtemp(path.join(output,'run-'));
if(!run.startsWith(output+path.sep))throw new Error('Resume must use an existing acceptance directory.');
const storage=path.join(run,'storage');
const source=process.env.CLIPFORGE_TEST_VIDEO,sourceHash=await hashFile(source),port=Number(process.env.CLIPFORGE_TEST_PORT||3175),base=`http://127.0.0.1:${port}`;
const accessKey=randomBytes(32).toString('hex'),sessionKey=randomBytes(32).toString('hex');
const env={...process.env,PORT:String(port),RENDER:'true',CLIPFORGE_REQUIRE_OWNER_AUTH:'false',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,CLIPFORGE_SESSION_KEY:sessionKey,
  CLIPFORGE_STORAGE_DIR:storage,CLIPFORGE_RUNTIME_HOME:path.join(storage,'.runtime-home'),CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',
  CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',
  CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_STORAGE_RETENTION_ENABLED:'false',CLIPFORGE_PROJECT_BACKUP_ENABLED:'false',
  CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:'',CLIPFORGE_ANALYSIS_PROVIDER:'heuristic',CLIPFORGE_MEDIA_WIDTH:'720',CLIPFORGE_MEDIA_HEIGHT:'1280',CLIPFORGE_RENDER_THREADS:'1',
  CLIPFORGE_MEDIA_STORAGE_PROVIDER:cloud?'r2':'local',CLIPFORGE_ZAI_API_KEY:'',ZAI_API_KEY:'',OPENAI_API_KEY:'',CLIPFORGE_AI_API_KEY:''};
const log=await open(path.join(run,resume?`runtime-resume-${Date.now()}.log`:'runtime.log'),'w');
const server=spawn(process.execPath,['scripts/render-runtime-free.mjs'],{env,stdio:['ignore',log.fd,log.fd]});
let browser,stage='BOOT';let evidence={checkedAt:new Date().toISOString(),run,sourceUrl:process.env.CLIPFORGE_TEST_SOURCE_URL,sourceHash,resumedExistingMedia:Boolean(resume),sourceOffset:Number(process.env.CLIPFORGE_TEST_SOURCE_OFFSET||0),synthetic:false,apiMocks:false,publicDeployment:false,physicalAndroid:false,realModel:true,externalAiCalls:0};
async function retryStorage(operation){for(let attempt=0;attempt<6;attempt++){try{return await operation();}catch(error){if(!['STORAGE_BUSY','STORAGE_CONFLICT'].includes(error.code)||attempt===5)throw error;await delay(Math.min(8000,1000*2**attempt));}}}
async function waitUntil(fn,seconds=240){for(let i=0;i<seconds;i++){const value=await fn();if(value)return value;await delay(1000);}throw new Error('ACCEPTANCE_TIMEOUT');}
try{
  await waitUntil(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},90);
  assert.equal((await fetch(base+'/api/projects')).status,401);
  assert.equal((await fetch(base+'/api/projects/test.with-dot')).status,401);
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
  const proxy=proxyUrl?{server:new URL(proxyUrl).origin,bypass:'127.0.0.1,localhost'}:undefined;
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox'],proxy});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,acceptDownloads:true,proxy});
  let page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  stage='OWNER_UPLOAD';await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  let job;let started=Date.now();
  if(resume){
    const jobs=[];for(const file of await readdir(path.join(storage,'jobs'))){if(!file.startsWith('bestclips-')||!file.endsWith('.json'))continue;const value=JSON.parse(await readFile(path.join(storage,'jobs',file),'utf8'));if(value.type==='MEDIA_CLIPS'&&value.status==='READY')jobs.push(value);}
    assert.equal(jobs.length,1);job=jobs[0];await page.close();
  }else{
  const form=page.locator('#clipforge-upload-panel');await form.locator('input[type=file]').setInputFiles(source);await form.getByRole('button',{name:'Subir video',exact:true}).click();
  await page.getByRole('region',{name:'Recorte manual'}).waitFor({timeout:60000});
  const originalPlayer=form.locator('video').first();await originalPlayer.evaluate(async video=>{video.muted=true;await video.play();});
  await page.waitForFunction(()=>document.querySelector('#clipforge-upload-panel video')?.currentTime>0.2);await originalPlayer.evaluate(v=>v.pause());
  const projects=await(await context.request.get(base+'/api/projects')).json();assert.equal(projects.projects.length,1);
  stage='AUTO_SELECT_TRANSLATE';await page.getByRole('button',{name:'CREAR MEJORES CLIPS',exact:true}).click();
  await page.getByLabel('Cantidad de clips',{exact:true}).fill('5');await page.getByLabel('Duración aproximada de cada clip en segundos',{exact:true}).fill('30');await page.getByLabel('Subtítulos automáticos',{exact:true}).selectOption('TRANSLATE_ES');
  const queuedResponse=page.waitForResponse(r=>r.url()===base+'/api/media/jobs'&&r.request().method()==='POST');
  await page.getByRole('button',{name:'Crear 5 clips de aprox. 30 s',exact:true}).click();const queued=await(await queuedResponse).json();assert.ok(queued.job?.id);
  await page.close();started=Date.now();
  job=await waitUntil(async()=>{const value=await(await context.request.get(`${base}/api/media/jobs/${queued.job.id}`)).json();const j=value.job;if(['FAILED','WAITING_RESOURCE','CANCELLED'].includes(j?.status))throw Object.assign(new Error('REAL_AUTO_PIPELINE_FAILED'),{jobState:j.status,jobError:j.error});return j?.status==='READY'?j:false;},360);
  }
  stage='PLAYBACK_SRT_DOWNLOAD';process.env.CLIPFORGE_STORAGE_DIR=storage;
  const project=await loadProjectFile(job.projectId);assert.equal(project.transcript.language,'en');assert.ok(project.clips.length>0&&project.clips.length<=5);
  assert.equal(await hashFile(path.join(storage,project.source.relativePath)),sourceHash);
  const clips=[];
  page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));await page.goto(base);
  const history=page.getByRole('region',{name:'Mis videos'});await history.getByRole('link',{name:'Descargar MP4',exact:true}).first().waitFor({timeout:30000});
  for(const clip of project.clips){
    assert.equal(clip.status,'READY');assert.equal(clip.subtitles.language,'es');assert.equal(clip.subtitles.translation.provider,'ctranslate2-cpu-local');assert.equal(clip.subtitles.translation.audioReplaced,false);assert.equal(clip.editorialReview.analysisKind,'LOCAL_HEURISTIC');
    const player=history.locator(`video[src="${clip.render.sourceUrl}"]`);await player.evaluate(async video=>{video.muted=true;await video.play();});await page.waitForFunction(url=>{const v=[...document.querySelectorAll('video')].find(v=>v.getAttribute('src')===url);return v&&v.currentTime>0.2&&v.videoWidth===720&&v.videoHeight===1280;},clip.render.sourceUrl);await player.evaluate(v=>v.pause());
    const file=path.join(run,clip.id+'.mp4');const downloaded=await context.request.get(base+clip.render.sourceUrl+'?download=1');assert.equal(downloaded.status(),200);await writeFile(file,await downloaded.body());assert.equal(await hashFile(file),clip.render.sha256);
    const validation=await validateMp4(file,{width:720,height:1280,duration:clip.duration,requireAudio:true});
    const srtResponse=await context.request.get(`${base}/api/projects/${project.id}/clips/${clip.id}/subtitles?format=srt`);assert.equal(srtResponse.status(),200);const srt=await srtResponse.text();assert.match(srt,/\d\d:\d\d:\d\d,\d\d\d -->/);await writeFile(path.join(run,clip.id+'.srt'),srt);
    clips.push({clipId:clip.id,startTime:clip.startTime,endTime:clip.endTime,originalStart:evidence.sourceOffset+clip.startTime,originalEnd:evidence.sourceOffset+clip.endTime,sha256:clip.render.sha256,validation,file,srt:path.join(run,clip.id+'.srt'),subtitles:clip.subtitles,reason:clip.reason});
  }
  assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:path.join(run,'mobile.png'),fullPage:false});
  evidence={...evidence,projectId:project.transcript.projectId,outputProjectId:project.id,jobId:job.id,tabClosedDuringProcessing:true,elapsedSeconds:(Date.now()-started)/1000,actualCount:clips.length,requestedCount:5,selectionMethod:'LOCAL_HEURISTIC',chatEvidence:'NOT_AVAILABLE',transcript:project.transcript,clips};
  if(cloud){
    stage='PRIVATE_R2_RECOVERY';const library=new ClipLibraryService();const archives=[];
    for(const clip of project.clips){const saved=await retryStorage(()=>library.archive(project,clip));await retryStorage(()=>library.setKeep(saved.id,true));archives.push({id:saved.id,sha256:saved.sha256});
      const access=await(await context.request.post(`${base}/api/media/library/${saved.id}/access`)).json();assert.ok(access.url);const renewed=await context.request.get(new URL(access.url,base).href);assert.equal(renewed.status(),200);const copy=path.join(run,saved.id+'-private.mp4');await writeFile(copy,await renewed.body());assert.equal(await hashFile(copy),clip.render.sha256);
    }
    const recovery=new ProjectRecoveryService({root:storage});const checkpoint=await retryStorage(()=>recovery.backup(project.id));const restoredRoot=path.join(run,'restored');await recovery.restore(project.id,{targetRoot:restoredRoot});
    process.env.CLIPFORGE_STORAGE_DIR=restoredRoot;const restored=await loadProjectFile(project.id);assert.equal(await hashFile(path.join(restoredRoot,restored.source.relativePath)),sourceHash);assert.deepEqual(restored.clips.map(c=>c.subtitles),project.clips.map(c=>c.subtitles));
    evidence={...evidence,archives,checkpoint,restoredRoot,privateDownloadHashesMatch:true,translatedProjectRestored:true};
  }
  await writeFile(path.join(run,'evidence.json'),JSON.stringify({...evidence,passed:true},null,2));console.log(JSON.stringify({passed:true,run,actualCount:clips.length,requestedCount:5,privateR2:cloud,realModel:true,publicDeployment:false,physicalAndroid:false}));
}catch(error){await writeFile(path.join(run,`failure-${Date.now()}.json`),JSON.stringify({passed:false,stage,code:error.code||error.name,jobState:error.jobState||null,jobError:error.jobError||null},null,2));console.error(JSON.stringify({passed:false,stage,code:error.code||error.name,run}));process.exitCode=1;}
finally{await browser?.close();server.kill('SIGTERM');await Promise.race([once(server,'exit'),delay(12000)]);await log.close();}
