// Authenticated mobile browser against real local APIs and R2. No uploads,
// caption edits, models, renders, live capture or social publishing are started.
import assert from 'node:assert/strict';import path from 'node:path';
import {spawn} from 'node:child_process';import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,open} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';import {loadProjectFile} from '../lib/project-files.mjs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
import {stopChildProcesses} from '../lib/child-shutdown.mjs';
if(!process.env.CLIPFORGE_AUDIO_ACCEPTANCE_RUN||!process.env.CLIPFORGE_LAYOUT_ACCEPTANCE_RUN)throw new Error('Use existing verified audio and layout acceptance directories.');
const run=path.resolve(process.env.CLIPFORGE_AUDIO_ACCEPTANCE_RUN),layout=path.resolve(process.env.CLIPFORGE_LAYOUT_ACCEPTANCE_RUN),allowed=path.resolve('artifacts/completion-20261027')+path.sep;
if(!run.startsWith(allowed)||!layout.startsWith(allowed))throw new Error('Unexpected acceptance directory.');
const root=path.join(run,'storage'),checkpoint=JSON.parse(await readFile(path.join(run,'checkpoint.json'),'utf8')),video=JSON.parse(await readFile(path.join(layout,'evidence.json'),'utf8'));
const nativeId=video.render.relativePath.split('/')[1];process.env.CLIPFORGE_STORAGE_DIR=root;
if(!await loadProjectFile(nativeId))await new ProjectRecoveryService({root}).restore(nativeId,{targetRoot:root});
const accessKey=randomBytes(32).toString('hex'),port=Number(process.env.CLIPFORGE_TEST_PORT||3182),base=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),RENDER:'true',CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,CLIPFORGE_SESSION_KEY:randomBytes(32).toString('hex'),
  CLIPFORGE_STORAGE_DIR:root,CLIPFORGE_RUNTIME_HOME:path.join(root,'.runtime-home'),CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',CLIPFORGE_AGENT_ENABLED:'false',
  CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_LIVE_MONITOR_ENABLED:'false',
  CLIPFORGE_PROJECT_BACKUP_ENABLED:'false',CLIPFORGE_STORAGE_RETENTION_ENABLED:'false',CLIPFORGE_MEDIA_STORAGE_PROVIDER:'r2',CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:''};
const log=await open(path.join(run,'readonly-mobile-runtime.log'),'w'),server=spawn(process.execPath,['scripts/render-runtime-free.mjs'],{env,stdio:['ignore',log.fd,log.fd]});let browser;
const digest=data=>createHash('sha256').update(data).digest('hex');
const evidence={checkedAt:new Date().toISOString(),nodeVersion:process.version,apiMocks:false,physicalAndroid:false,publicDeployment:false,newEncodes:0,newModelCalls:0};
try{
  let ready=false;for(let i=0;i<60;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(1000);}assert.ok(ready);
  assert.equal((await fetch(base+'/api/projects')).status,401);assert.equal((await fetch(base+'/api/projects/anything.with-dot')).status,401);
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,proxy=proxyUrl?{server:new URL(proxyUrl).origin,bypass:'127.0.0.1,localhost'}:undefined;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,proxy}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  await page.locator(`article[data-project-id="${checkpoint.projectId}"]`).getByRole('button',{name:'Abrir proyecto',exact:true}).click();
  await page.getByRole('region',{name:'Recorte manual'}).waitFor();assert.equal(await page.getByLabel('Resolución del recorte',{exact:true}).count(),0);
  const audio=page.locator('#clipforge-upload-panel audio').first();await audio.evaluate(async el=>{el.muted=true;await el.play();});await delay(400);assert.ok(await audio.evaluate(el=>el.currentTime)>0);await audio.evaluate(el=>el.pause());
  const manual=(await loadProjectFile(checkpoint.projectId)).clips.find(c=>c.candidateId.startsWith('manual-'));
  const audioDownload=await context.request.get(base+manual.render.sourceUrl+'?download=1');assert.equal(audioDownload.headers()['content-type'],'audio/mp4');assert.equal(digest(await audioDownload.body()),manual.render.sha256);
  await page.getByText('Rechazado en revisión. Se conserva el archivo para corregir el recorte.',{exact:true}).first().waitFor();
  await page.locator(`article[data-project-id="${nativeId}"]`).getByRole('button',{name:'Abrir proyecto',exact:true}).click();await page.getByLabel('Tamaño de subtítulos',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Posición de subtítulos',{exact:true}).inputValue(),'TOP');assert.equal(await page.getByLabel('Tamaño de subtítulos',{exact:true}).inputValue(),'60');
  const input=await page.getByLabel('Tamaño de subtítulos',{exact:true}).boundingBox();assert.ok(input.height>=44);
  const original=page.locator('#clipforge-upload-panel video').first();await original.evaluate(async el=>{el.muted=true;await el.play();});await delay(400);assert.ok(await original.evaluate(el=>el.currentTime)>0);await original.evaluate(el=>el.pause());
  const native=(await loadProjectFile(nativeId)).clips[0],download=await context.request.get(base+native.render.sourceUrl+'?download=1');assert.equal(download.headers()['content-type'],'video/mp4');assert.equal(digest(await download.body()),video.sha256);
  const srt=await context.request.get(`${base}/api/projects/${nativeId}/clips/${native.id}/subtitles?format=srt`);assert.equal(srt.status(),200);assert.match(await srt.text(),/Presidency/);
  const access=await context.request.post(`${base}/api/media/library/${video.r2.archiveId}/access`);assert.equal(access.status(),200);const signed=await access.json();const privateFile=await context.request.get(signed.url);assert.equal(privateFile.status(),200);assert.equal(digest(await privateFile.body()),video.sha256);
  assert.equal(errors.length,0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:path.join(run,'readonly-mobile-review.png'),fullPage:true});
  evidence.passed=true;evidence.editorialRejectionVisible=true;evidence.audioPlaybackAndDownload=true;evidence.videoPlaybackAndDownload=true;evidence.subtitleControlsUsable=true;evidence.srtDownload=true;evidence.r2RenewalAndDownload=true;evidence.nativeSha256=video.sha256;
  await writeFile(path.join(run,'readonly-mobile-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}catch(error){evidence.passed=false;evidence.diagnostic=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu,'[URL_REDACTED]').slice(0,300);await writeFile(path.join(run,'readonly-mobile-evidence.json'),JSON.stringify(evidence,null,2));console.error(JSON.stringify(evidence));process.exitCode=1;}
finally{await browser?.close();await stopChildProcesses([server],{graceMs:12000});await log.close();}
