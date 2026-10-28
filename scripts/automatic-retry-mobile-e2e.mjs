// Resume the already generated authorized automatic acceptance clip. No new
// upload/ASR/translation/R2 write. Real mobile HTTP and render worker/checkpoint.
import assert from 'node:assert/strict';import path from 'node:path';
import {spawn} from 'node:child_process';import {randomBytes} from 'node:crypto';
import {readFile,open,writeFile} from 'node:fs/promises';import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';import {loadProjectFile,updateProjectFile} from '../lib/project-files.mjs';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';import {stopChildProcesses} from '../lib/child-shutdown.mjs';
const arg=process.argv.find(value=>value.startsWith('--run='))?.slice(6);
if(!arg||!process.argv.includes('--rights-confirmed'))throw new Error('Use an authorized existing --run=PATH and --rights-confirmed.');
const run=path.resolve(arg);assert.ok(run.startsWith(path.resolve('artifacts/master-mission-20261028')+path.sep));
const previous=JSON.parse(await readFile(path.join(run,'evidence.json'),'utf8'));assert.equal(previous.passed,true);
const root=path.join(run,'storage');process.env.CLIPFORGE_STORAGE_DIR=root;const saved=await loadProjectFile(previous.projectId),clip=saved.clips.find(item=>item.id===previous.clipId);
assert.equal(clip.status,'READY');const hash=await hashFile(path.join(root,clip.render.relativePath));assert.equal(hash,previous.outputSha256);
const port=Number(process.env.CLIPFORGE_TEST_PORT||3193),base=`http://127.0.0.1:${port}`,accessKey=randomBytes(32).toString('hex');
const env={...process.env,CLIPFORGE_STORAGE_DIR:root,CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,CLIPFORGE_SESSION_KEY:randomBytes(32).toString('hex'),
  CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',CLIPFORGE_MEDIA_STORAGE_PROVIDER:'local',CLIPFORGE_PROJECT_BACKUP_ENABLED:'false',
  CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',
  CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:''};
const log=await open(path.join(run,'retry-runtime.log'),'w'),server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{env,stdio:['ignore',log.fd,log.fd]});
let browser,worker;const evidence={checkedAt:new Date().toISOString(),publicDeployment:false,physicalAndroid:false,apiMocks:false,originalAcceptanceRun:run,newEncodes:0,newAsr:0,newTranslationCalls:0,r2Writes:0};
try{
  let ready=false;for(let i=0;i<50;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await delay(500);}assert.ok(ready);
  await updateProjectFile(saved.id,current=>{const item=current.clips.find(c=>c.id===clip.id);item.status='DRAFT';item.render=null;});
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true}),page=await context.newPage();
  await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  const article=page.locator(`article[data-media-job-id="bestclips-${saved.id}"]`);await article.getByRole('button',{name:'Revisar cortes y subtítulos',exact:true}).click();
  await article.getByLabel(`Texto del subtítulo ${clip.subtitles.cues[0].id}`,{exact:true}).waitFor();
  const request=page.waitForResponse(res=>res.url()===`${base}/api/projects/${saved.id}/clips`&&res.request().method()==='POST');
  await article.getByRole('button',{name:'Renderizar esta revisión',exact:true}).click();const response=await request;
  assert.deepEqual(response.request().postDataJSON(),{retryClipId:clip.id});assert.equal(response.status(),202);
  worker=spawn(process.execPath,['scripts/render-worker.mjs','--once'],{env,stdio:['ignore',log.fd,log.fd]});
  let current;for(let i=0;i<100;i++){
    current=await loadProjectFile(saved.id);if(current.clips[0].status==='READY')break;if(current.clips[0].status==='FAILED')throw new Error('Retry failed');await delay(500);
  }
  assert.equal(current.clips.length,1);const resumed=current.clips[0];assert.equal(resumed.id,clip.id);assert.equal(resumed.status,'READY');
  assert.equal(resumed.render.recoveredWithoutEncoding,true);assert.equal(await hashFile(path.join(root,resumed.render.relativePath)),hash);
  assert.equal(resumed.edit.output.width,1280);assert.equal(resumed.edit.output.height,720);assert.equal(resumed.edit.quality,'EFFICIENT');
  assert.deepEqual(resumed.subtitles,clip.subtitles);
  const refreshed=(await(await context.request.get(`${base}/api/media/jobs/bestclips-${saved.id}`)).json()).job.result.clips[0];assert.equal(refreshed.available,true);assert.equal(refreshed.renderProfile.width,1280);
  await article.getByRole('link',{name:'Descargar MP4',exact:true}).waitFor({timeout:15000});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  evidence.clipId=clip.id;evidence.sha256=hash;evidence.keptIdentityGeometryAndCaptions=true;evidence.recoveredWithoutEncoding=true;evidence.draftCaptionEditorVisible=true;evidence.passed=true;
}catch(error){evidence.passed=false;evidence.diagnostic=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu,'[URL_REDACTED]').slice(0,300);process.exitCode=1;}
finally{await browser?.close();await stopChildProcesses([worker,server].filter(Boolean),{graceMs:5000});await log.close();await writeFile(path.join(run,'retry-evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));}
