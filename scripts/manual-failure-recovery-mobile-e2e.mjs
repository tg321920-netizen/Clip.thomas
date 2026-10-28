// Genuine cached audio + real APIs/render worker. Deliberately choose the wrong
// caption language, observe a real failure and repair it using mobile touch UI.
// No new recording, ASR/model calls, encoding, R2 writes or production request.
import assert from 'node:assert/strict';import path from 'node:path';
import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,link,copyFile,open} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';import {chromium} from 'playwright';
import {loadProjectFile,updateProjectFile} from '../lib/project-files.mjs';
import {markClipQueued} from '../services/clip/ClipService.mjs';import {JobStore} from '../services/JobStore.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {stopChildProcesses} from '../lib/child-shutdown.mjs';
const argument=process.argv.find(value=>value.startsWith('--source-project='))?.slice(17);
if(!argument||!process.argv.includes('--rights-confirmed'))throw new Error('Provide an existing authorized AUDIO project with --source-project=PATH and --rights-confirmed.');
const file=path.resolve(argument);assert.ok(file.startsWith(path.resolve('artifacts')+path.sep));
const originalRoot=path.dirname(path.dirname(file)),project=JSON.parse(await readFile(file,'utf8'));
assert.equal(project.source.mediaKind,'AUDIO');assert.equal(project.transcript.language,'en');assert.equal(project.transcript.status,'COMPLETED');
const originalClip=project.clips.find(c=>c.status==='READY'&&c.candidateId.startsWith('manual-')&&c.subtitles?.cues?.length&&c.render?.relativePath);
assert.ok(originalClip);const originalRender=structuredClone(originalClip.render),originalHash=await hashFile(path.join(originalRoot,originalRender.relativePath));
const parent=path.resolve('artifacts/verification-20261028');await mkdir(parent,{recursive:true});
const run=await mkdtemp(path.join(parent,'manual-recovery-')),root=path.join(run,'storage');
for(const relative of new Set([project.source.relativePath,originalRender.relativePath])){
  const destination=path.resolve(root,relative);assert.ok(destination.startsWith(root+path.sep));await mkdir(path.dirname(destination),{recursive:true});await link(path.resolve(originalRoot,relative),destination);
}
const proof=originalRender.relativePath.replace(/render\.mp4$/,'render-proof.json');await copyFile(path.join(originalRoot,proof),path.join(root,proof));
project.clips=[originalClip];project.testOnly=true;project.source.testOnly=true;
await mkdir(path.join(root,'projects'),{recursive:true});await writeFile(path.join(root,'projects',project.id+'.json'),JSON.stringify(project));process.env.CLIPFORGE_STORAGE_DIR=root;
const port=Number(process.env.CLIPFORGE_TEST_PORT||3195),base=`http://127.0.0.1:${port}`,accessKey=randomBytes(32).toString('hex');
const env={...process.env,CLIPFORGE_STORAGE_DIR:root,CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,CLIPFORGE_SESSION_KEY:randomBytes(32).toString('hex'),
  CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',CLIPFORGE_MEDIA_STORAGE_PROVIDER:'local',CLIPFORGE_PROJECT_BACKUP_ENABLED:'false',
  CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',
  CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:'',
  CLIPFORGE_TRANSLATION_PYTHON:'',CLIPFORGE_TRANSLATION_MODEL_PATH:''};
const log=await open(path.join(run,'runtime.log'),'w'),server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:['ignore',log.fd,log.fd]});
let browser,worker;const evidence={checkedAt:new Date().toISOString(),run,apiMocks:false,physicalAndroid:false,publicDeployment:false,
  source:'CACHED_AUTHORIZED_NASA_AUDIO_WITH_REAL_WHISPER_TRANSCRIPT',newClips:0,newEncodes:0,newAsr:0,modelCalls:0,r2Writes:0};let stage='START';
async function runWorker(){worker=spawn(process.execPath,['scripts/render-worker.mjs','--once'],{env,stdio:['ignore',log.fd,log.fd]});
  let done=false;for(let i=0;i<100;i++){if(worker.exitCode!==null){done=true;break;}await delay(200);}assert.ok(done,'Controlled worker did not finish');assert.equal(worker.exitCode,0);}
try{
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(500);}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.name));
  await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).tap();await page.waitForURL(base+'/');
  stage='ACTIVE_OWNER_PROTECTION';await updateProjectFile(project.id,current=>{current.clips[0].status='PROCESSING';});
  const before=await readFile(path.join(root,'projects',project.id+'.json'),'utf8');
  const conflict=await context.request.post(`${base}/api/projects/${project.id}/clips`,{data:{retryClipId:originalClip.id}});assert.equal(conflict.status(),409);
  assert.equal(await readFile(path.join(root,'projects',project.id+'.json'),'utf8'),before);
  const jobs=new JobStore();assert.equal(await jobs.getRenderJob(project.id,originalClip.id),null);evidence.activeOwnerConflict409=true;
  // This is an intentional input mistake over genuine media, not a mocked error.
  stage='REAL_WRONG_LANGUAGE_FAILURE';await updateProjectFile(project.id,current=>{const clip=current.clips[0];clip.status='DRAFT';clip.render=null;clip.edit.subtitleMode='ORIGINAL_ES';clip.edit.subtitleRegenerate=true;});
  await markClipQueued(project.id,originalClip.id);const queued=await jobs.enqueueRender(project.id,originalClip.id);await runWorker();
  let saved=await loadProjectFile(project.id);assert.equal(saved.clips[0].status,'FAILED');assert.equal((await jobs.get(queued.id)).status,'FAILED');assert.match(saved.clips[0].error,/audio detectado no es español/);
  stage='MOBILE_CORRECTION';await page.locator(`article[data-project-id="${project.id}"]`).getByRole('button',{name:'Abrir proyecto',exact:true}).tap();
  const editor=page.getByRole('region',{name:'Recorte manual'});const language=editor.getByLabel('Idioma de subtítulos',{exact:true});await language.waitFor();assert.equal(await language.isEnabled(),true);
  assert.equal(await editor.getByLabel('Tamaño de subtítulos',{exact:true}).count(),0);assert.equal(await editor.getByText('Auto Focus',{exact:true}).count(),0);evidence.failedAudioEditorVisibleWithoutVideoControls=true;
  // An interrupted enqueue can leave QUEUED metadata with a terminal/missing job.
  await updateProjectFile(project.id,current=>{current.clips[0].status='QUEUED';});
  const retryButton=editor.getByRole('button',{name:'Reintentar render',exact:true});await retryButton.waitFor({timeout:10000});assert.equal(await retryButton.isEnabled(),true);
  assert.ok((await retryButton.boundingBox()).height>=44);evidence.orphanedQueuedClipRetryVisible=true;
  await updateProjectFile(project.id,current=>{current.clips[0].status='FAILED';});await delay(3000);
  await language.selectOption('ORIGINAL_EN');const post=page.waitForResponse(res=>res.url()===`${base}/api/projects/${project.id}/clips/${originalClip.id}/subtitles`&&res.request().method()==='POST');
  const apply=editor.getByRole('button',{name:'Aplicar idioma y renderizar',exact:true});assert.ok((await apply.boundingBox()).height>=44);await apply.tap();assert.equal((await post).status(),202);
  for(let i=0;i<30;i++){if((await jobs.get(queued.id)).status==='QUEUED')break;await delay(100);}await runWorker();
  saved=await loadProjectFile(project.id);const result=saved.clips[0];assert.equal(result.status,'READY');assert.equal(saved.clips.length,1);assert.equal(result.id,originalClip.id);
  assert.equal(result.subtitles.mode,'ORIGINAL_EN');assert.equal(result.subtitles.language,'en');assert.equal(result.render.recoveredWithoutEncoding,true);
  assert.equal(await hashFile(path.join(root,result.render.relativePath)),originalHash);assert.equal(await hashFile(path.join(originalRoot,originalRender.relativePath)),originalHash);
  assert.ok(result.subtitleHistory?.length);evidence.savedOriginalSubtitleHistory=true;
  stage='PLAYBACK_DOWNLOAD';const audio=editor.getByLabel('Reproducir recorte de audio',{exact:true});await audio.waitFor({timeout:15000});await audio.evaluate(async el=>{el.muted=true;await el.play();});await delay(400);assert.ok(await audio.evaluate(el=>el.currentTime)>.1);await audio.evaluate(el=>el.pause());
  const [download]=await Promise.all([page.waitForEvent('download'),editor.getByRole('link',{name:'Descargar recorte M4A',exact:true}).tap()]);const downloaded=path.join(run,'recovered-original.m4a');await download.saveAs(downloaded);assert.equal(await hashFile(downloaded),originalHash);
  evidence.validation=await validateMp4(downloaded,{audioOnly:true,requireAudio:true,duration:result.duration});
  const srt=await context.request.get(`${base}/api/projects/${project.id}/clips/${result.id}/subtitles?format=srt`);assert.equal(srt.status(),200);assert.ok((await srt.text()).includes(result.subtitles.cues[0].text));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));assert.deepEqual(errors,[]);await page.screenshot({path:path.join(run,'mobile.png'),fullPage:true});
  evidence.sha256=originalHash;evidence.clipId=result.id;evidence.actualWorkerRejectedWrongLanguage=true;evidence.correctedThroughTouchUi=true;evidence.recoveredWithoutEncoding=true;evidence.originalAndCorrectedSrtPreserved=true;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.stage=stage;evidence.diagnostic=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu,'[URL_REDACTED]').slice(0,320);process.exitCode=1;}
finally{await browser?.close();await stopChildProcesses([worker,server].filter(Boolean),{graceMs:5000});await log.close();await writeFile(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
