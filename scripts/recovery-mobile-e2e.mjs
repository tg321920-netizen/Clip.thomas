// Recovery and new editing controls against actual local HTTP APIs and private
// R2. No synthetic video, API interception, paid model or production mutation.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,open,readFile,writeFile,stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';

if(process.env.CLIPFORGE_RUN_R2_TESTS!=='true'||!process.argv.includes('--rights-confirmed'))throw new Error('Esta prueba exige R2 y material real autorizado.');
const id=process.argv.find(a=>a.startsWith('--project='))?.slice(10);
if(!id)throw new Error('Indica --project=UUID de un respaldo real ya existente.');
const output=path.resolve('artifacts/recovery-mobile');await mkdir(output,{recursive:true});
const run=await mkdtemp(path.join(output,'run-')),root=path.join(run,'empty-storage'),port=3181,base='http://127.0.0.1:'+port;
await mkdir(root);
const key=randomBytes(32).toString('hex'),session=randomBytes(32).toString('hex'),log=await open(path.join(run,'server.log'),'w');
const env={...process.env,PORT:String(port),CLIPFORGE_STORAGE_DIR:root,CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',
  CLIPFORGE_PROJECT_BACKUP_ENABLED:'true',CLIPFORGE_PROJECT_BACKUP_AUTO:'false',CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:key,CLIPFORGE_SESSION_KEY:session,
  CLIPFORGE_STORAGE_RETENTION_ENABLED:'false',CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',
  CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',CLIPFORGE_CONTENT_RUNTIME_URL:'',
  CLIPFORGE_ZAI_API_KEY:'',ZAI_API_KEY:'',OPENAI_API_KEY:'',WHISPER_CPP_COMMAND:'/no-whisper-in-manual-test'};
const children=[],start=args=>{const child=spawn(process.execPath,args,{env,detached:true,stdio:['ignore',log.fd,log.fd]});children.push(child);return child;};
const stop=(child,signal='SIGTERM')=>{if(child?.pid)try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
let browser,stage='BOOT',evidence={checkedAt:new Date().toISOString(),physicalAndroid:false,mobileChromium:true,apiMocks:false,realR2:true,productionChanged:false,run};
try{
  start(['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)]);
  start(['scripts/project-backup-worker.mjs']);
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}await delay(200);}
  assert.equal((await fetch(base+'/api/projects/recovery')).status,401);
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,acceptDownloads:true});let page=await context.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(key);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  stage='RESTORE_FROM_ANDROID_UI';
  const cloud=page.getByRole('region',{name:'Respaldo y recuperación de proyectos'});
  await cloud.locator('[data-recovery-project="'+id+'"]').getByRole('button',{name:'Recuperar proyecto del respaldo',exact:true}).click({timeout:30000});
  for(let i=0;i<180;i++){
    const response=await context.request.get(base+'/api/projects'),body=await response.json();
    if(body.projects?.some(p=>p.id===id))break;
    const state=await(await context.request.get(base+'/api/projects/recovery')).json();
    if(state.requests?.some(r=>r.projectId===id&&r.status==='FAILED'))throw new Error('Recovery worker failed.');
    await delay(1000);
  }
  const restored=JSON.parse(await readFile(path.join(root,'projects',id+'.json'),'utf8'));
  assert.equal(restored.recovery.status,'RESTORED');assert.equal(restored.recovery.jobsPaused,true);
  assert.equal(await hashFile(path.join(root,restored.source.relativePath)),'a53c477728d61778ceda6b7b33a7c86b6ab479333d6d9abc09e4e96e7dd08783');
  await page.getByRole('button',{name:'Abrir proyecto',exact:true}).click({timeout:30000});
  const editor=page.getByRole('region',{name:'Recorte manual'});await editor.waitFor();
  await editor.getByLabel('Inicio del fragmento en segundos',{exact:true}).fill('60');
  await editor.getByLabel('Final del fragmento en segundos',{exact:true}).fill('68');
  await editor.getByLabel('Formato del recorte',{exact:true}).selectOption('16:9');
  await editor.getByLabel('Resolución del recorte',{exact:true}).selectOption('720p');
  await editor.getByLabel('Calidad del recorte',{exact:true}).selectOption('EFFICIENT');
  await editor.getByLabel('Tengo autorización para recortar este video.',{exact:true}).check();
  const response=page.waitForResponse(r=>r.url()===base+'/api/projects/'+id+'/clips'&&r.request().method()==='POST');
  await editor.getByRole('button',{name:'Generar MP4 del fragmento',exact:true}).click();
  const queued=await(await response).json(),clipId=queued.clip.id;
  stage='REAL_WORKER_INTERRUPTION';
  const worker=start(['scripts/render-worker.mjs']);
  const partial=path.join(root,'clips',id,clipId,'render.partial.mp4');let interrupted=false;
  for(let i=0;i<300;i++){
    const info=await stat(partial).catch(()=>null);
    if(info?.size>0){stop(worker,'SIGKILL');interrupted=true;break;}await delay(30);
  }
  assert.equal(interrupted,true);
  await new Promise(resolve=>worker.exitCode!==null||worker.signalCode!==null?resolve():worker.once('exit',resolve));
  await page.close();start(['scripts/render-worker.mjs']);
  let clip;
  for(let i=0;i<120;i++){
    const body=await(await context.request.get(base+'/api/projects/'+id+'/clips')).json();clip=body.clips?.find(c=>c.id===clipId);
    if(clip?.status==='READY')break;await delay(1000);
  }
  assert.equal(clip?.status,'READY');assert.ok(clip.job.attempts>=2);
  stage='RETURN_PLAY_AND_DOWNLOAD';
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.getByRole('button',{name:'Abrir proyecto',exact:true}).click();
  const result=page.locator('article').filter({has:page.locator('video[src="'+clip.render.sourceUrl+'"]')}).first();
  const player=result.getByLabel('Reproducir recorte manual');
  await player.evaluate(async video=>{video.muted=true;await video.play();});
  await page.waitForFunction(url=>{const video=document.querySelector('video[src="'+url+'"]');return video&&video.videoWidth===1280&&video.videoHeight===720&&video.currentTime>0.2;},clip.render.sourceUrl);
  await player.evaluate(video=>video.pause());
  const [download]=await Promise.all([page.waitForEvent('download'),result.getByRole('link',{name:'Descargar recorte MP4',exact:true}).click()]);
  const file=path.join(run,'horizontal-qa.mp4');await download.saveAs(file);
  assert.equal(await download.failure(),null);
  const validation=await validateMp4(file,{duration:8,width:1280,height:720,requireAudio:true});
  assert.equal(await hashFile(file),await hashFile(path.join(root,clip.render.relativePath)));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(errors,[]);
  await page.screenshot({path:path.join(run,'mobile.png'),fullPage:false});
  evidence={...evidence,passed:true,projectId:id,clipId,restoredOriginalHashMatched:true,jobsRestoredPaused:true,workerKilledDuringActualFfmpeg:true,
    recoveredRenderAttempts:clip.job.attempts,browserClosedDuringRestart:true,horizontalPlayback:true,downloadHashMatched:true,validation,
    subtitles:'NOT_REQUESTED',aiCalls:0,newStreamerDeliverables:0,newR2Media:0};
  await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify({passed:true,projectId:id,clipId,workerRestarted:true,horizontalPlayback:true,downloadHashMatched:true,physicalAndroid:false}));
}catch(error){
  await writeFile(path.join(output,'failure.json'),JSON.stringify({...evidence,stage,passed:false,code:error.code||error.name},null,2));
  console.error(JSON.stringify({passed:false,stage,code:error.code||error.name}));process.exitCode=1;
}finally{
  await browser?.close();for(const child of children)stop(child);await delay(250);for(const child of children)if(child.exitCode===null&&child.signalCode===null)stop(child,'SIGKILL');await log.close();
}
