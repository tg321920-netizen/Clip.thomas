// Real localhost application and R2; no API mocks. Chromium emulates a phone.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
const base='http://127.0.0.1:3161',output=process.env.CLIPFORGE_MOBILE_EVIDENCE_DIR||'artifacts/stability/mobile';await mkdir(output,{recursive:true});
const clipId=process.env.CLIPFORGE_MOBILE_ARCHIVE_ID||'fdbf5529b6ef764bce8a1bf81fe957da8f5ae2f445b1573968ac8ff906f8fa42';
const expectedSha256=process.env.CLIPFORGE_MOBILE_EXPECTED_SHA256||'a0b4a9b2855fe6854859131a520981a5c46fbbc9c64bb1ebf08718ccd8b8b483';
assert.match(clipId,/^[a-f0-9]{64}$/);assert.match(expectedSha256,/^[a-f0-9]{64}$/);
const env={...process.env,CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL_ENV:'',CLIPFORGE_REQUIRE_OWNER_AUTH:'false',CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS:'false',CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false'};
const server=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','-p','3161'],{env,stdio:'ignore'});let browser;
try{
  let ready=false;for(let i=0;i<120;i++){try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,250));}assert.ok(ready);
  browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});const page=await browser.newPage({viewport:{width:393,height:851},isMobile:true,hasTouch:true,acceptDownloads:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base,{waitUntil:'domcontentloaded'});
  const panel=page.getByRole('region',{name:'Estado de captura de Westcol'});await panel.getByText(/Monitor: Desactivado/).waitFor({timeout:45000});
  const status=await(await page.request.get(base+'/api/live/status')).json();assert.equal(status.monitor.enabled,false);assert.equal(status.publishing,'OFF');assert.ok(status.sessions.length>=2);
  const id=clipId,library=page.getByRole('region',{name:'Clips guardados en nube'}),player=library.locator(`video[src="/api/media/library/${id}/source"]`);await player.waitFor({timeout:60000});const article=player.locator('..');
  assert.equal(await library.getByRole('button',{name:'Clips de Westcol',exact:true}).getAttribute('aria-pressed'),'true');
  await player.evaluate(async video=>{video.muted=true;await video.play();});
  await page.waitForFunction(id=>{const video=document.querySelector(`video[src="/api/media/library/${id}/source"]`);return video&&video.currentTime>0.3&&video.videoWidth===1080&&video.videoHeight===1920;},id,{timeout:60000});
  await player.evaluate(video=>video.pause());
  await article.getByText('Ver contexto y nuevo recorte',{exact:true}).click();await article.getByText('Transcripción automática: puede contener errores.',{exact:true}).waitFor();
  await article.getByRole('button',{name:'Solicitar nuevo recorte',exact:true}).click();await article.getByLabel('Inicio del nuevo recorte (segundos)').fill('5');await article.getByLabel('Final del nuevo recorte (segundos)').fill('35');assert.ok(await article.getByRole('button',{name:'Encolar recorte',exact:true}).isEnabled());
  // Do not mutate an owner's review or enqueue a duplicate real event.
  await article.getByRole('button',{name:'Cancelar recorte',exact:true}).click();await article.getByRole('button',{name:'Rechazar',exact:true}).waitFor();
  await article.getByRole('button',{name:'Renovar acceso privado',exact:true}).click();const link=article.getByRole('link',{name:'Descargar con enlace temporal',exact:true});await link.waitFor({timeout:30000});
  const [download]=await Promise.all([page.waitForEvent('download'),link.click()]);const file=output+'/renewed-private.mp4';await download.saveAs(file);assert.equal(await download.failure(),null);assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'),expectedSha256);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);assert.equal(overflow,false);assert.deepEqual(errors,[]);await page.screenshot({path:output+'/review.png',fullPage:false});
  const evidence={checkedAt:new Date().toISOString(),passed:true,archiveId:id,sha256:expectedSha256,apiMocks:false,physicalAndroid:false,viewport:'393x851',actualPrivateR2Playback:true,actualPrivateR2Download:true,downloadHashMatched:true,captureStarted:false,reviewMutated:false,recutSubmitted:false,sourceStatus:status.source.status,monitorEnabled:status.monitor.enabled,noHorizontalOverflow:!overflow,noJavaScriptErrors:true};await writeFile(output+'/evidence.json',JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}finally{await browser?.close();server.kill('SIGTERM');}
