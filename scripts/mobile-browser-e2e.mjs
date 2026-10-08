import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir,mkdtemp,rm,writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { validateMp4 } from "../services/media-processing/MediaValidationService.mjs";
import { PUBLISHING_ENABLED } from "../lib/publishing-policy.mjs";
const { chromium,devices }=await import(process.env.PLAYWRIGHT_MODULE || "/tmp/clipforge-browser/node_modules/playwright/index.mjs");
const output=path.resolve("artifacts/mobile-browser");await mkdir(output,{recursive:true});
const storage=await mkdtemp(path.join(os.tmpdir(),"clipforge-mobile-"));
const env={...process.env,CLIPFORGE_STORAGE_DIR:storage,CLIPFORGE_MEDIA_WIDTH:"360",CLIPFORGE_MEDIA_HEIGHT:"640",CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS:"false"};
const base="http://127.0.0.1:3113";let log="";
const next=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3113"],{env,stdio:["ignore","pipe","pipe"]});
next.stdout.on("data",c=>{log+=c;});next.stderr.on("data",c=>{log+=c;});
let browser,ingest,page;
async function worker(){await new Promise((resolve,reject)=>{const child=spawn(process.execPath,["scripts/media-worker.mjs","--once"],{env,stdio:["ignore","pipe","pipe"]});let logs="";child.stdout.on("data",c=>{logs+=c;});child.stderr.on("data",c=>{logs+=c;});child.on("error",reject);child.on("exit",code=>code===0?resolve():reject(new Error(logs)));});}
try{
  for(let i=0;i<100;i++){try{if((await fetch(`${base}/api/health`)).ok)break;}catch{}if(next.exitCode!==null)throw new Error(log);await new Promise(r=>setTimeout(r,200));}
  browser=await chromium.launch({channel:"chrome",headless:true});const context=await browser.newContext({...devices["Pixel 5"],acceptDownloads:true});page=await context.newPage();await page.goto(base);
  console.log("Browser media codecs:",await page.evaluate(()=>{const video=document.createElement("video");return {h264:video.canPlayType('video/mp4; codecs="avc1.42E01E"'),aac:video.canPlayType('audio/mp4; codecs="mp4a.40.2"')};}));
  for(const name of ["CREAR HISTORIA CON IA","EDITAR VIDEO AUTOMÁTICAMENTE","SACAR MEJORES CLIPS"])await page.getByRole("button",{name,exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,"Mobile layout must not overflow horizontally");
  if(process.argv.includes("--clips-only")) {
    ingest=spawn(process.execPath,["scripts/ingest-worker.mjs"],{env,stdio:"ignore"});
    await page.getByRole("button",{name:"SACAR MEJORES CLIPS",exact:true}).click();
    await page.locator('input[type="file"][accept*="video/mp4"]').first().setInputFiles(path.resolve("artifacts/best-clips/podcast-20m.mp4"));
    await page.getByRole("button",{name:"Subir y analizar",exact:true}).first().click();await page.getByText(/Original guardado:/).waitFor({timeout:90000});
    const saved=page.waitForResponse(r=>r.url().endsWith("/api/media/jobs")&&r.request().method()==="POST");
    await page.getByRole("button",{name:"Generar mejores clips",exact:true}).click();const clipJob=(await(await saved).json()).job;
    await page.close();await worker();page=await context.newPage();await page.goto(base);
    const article=page.getByRole("region",{name:"Mis videos",exact:true}).locator("article").first();await article.getByText(/READY/).waitFor({timeout:10000});
    const persisted=await(await fetch(`${base}/api/media/jobs/${clipJob.id}`)).json();assert.equal(persisted.job.status,"READY");assert.equal(persisted.job.result.clips.length,3);
    const validations=[];
    for(let i=0;i<3;i++){
      const video=article.locator("video").nth(i);await video.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForTimeout(400);assert.ok(await video.evaluate(v=>v.currentTime)>0);await video.evaluate(v=>v.pause());
      const downloading=page.waitForEvent("download");await article.getByRole("link",{name:"Descargar MP4"}).nth(i).click();const file=path.join(output,`browser-clip-${i+1}.mp4`);await(await downloading).saveAs(file);
      validations.push(await validateMp4(file,{requireAudio:true,duration:persisted.job.result.clips[i].duration,width:360,height:640}));
    }
    await page.screenshot({path:path.join(output,"mobile-clips.png"),fullPage:true});assert.equal(PUBLISHING_ENABLED,false);
    const evidence={passed:true,client:"Chromium with Pixel 5 Android browser emulation; physical Android device not tested",tool:"MEDIA_CLIPS",validations,sourceDuration:1200,browserClosedDuringRender:true,actualBrowserPlayback:true,threeBrowserDownloads:true,publishing:"OFF"};await writeFile(path.join(output,"clips-evidence.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  } else {
  const saved=page.waitForResponse(r=>r.url().endsWith("/api/media/jobs")&&r.request().method()==="POST");await page.getByRole("button",{name:"Generar historia",exact:true}).click();const storyJob=(await (await saved).json()).job;
  await page.close();await worker(); // Browser is closed while all rendering occurs on the server.
  page=await context.newPage();await page.goto(base);let article=page.getByRole("region",{name:"Mis videos",exact:true}).locator("article").first();await article.getByText(/READY/).waitFor({timeout:10000});
  const history=await (await fetch(`${base}/api/media/jobs/${storyJob.id}`)).json();assert.equal(history.job.status,"READY");assert.ok(history.job.history.some(h=>h.status==="VALIDATING"));
  const mediaResponse=await fetch(`${base}${history.job.result.sourceUrl}`,{headers:{Range:"bytes=0-1023"}});assert.equal(mediaResponse.status,206,"The actual MP4 route must return bytes before playback");
  const video=article.locator("video");await video.evaluate(async v=>{v.muted=true;await v.play();});await page.waitForTimeout(500);assert.ok(await video.evaluate(v=>v.currentTime)>0,"Actual browser playback must advance");await video.evaluate(v=>v.pause());
  const downloading=page.waitForEvent("download");await article.getByRole("link",{name:"Descargar MP4"}).click();const download=await downloading;await download.saveAs(path.join(output,"browser-story.mp4"));
  const storyValidation=await validateMp4(path.join(output,"browser-story.mp4"),{requireAudio:true,duration:60,width:360,height:640});
  const range=await fetch(`${base}${history.job.result.sourceUrl}`,{headers:{Range:"bytes=0-1023"}});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,1024);
  await page.screenshot({path:path.join(output,"mobile-story.png"),fullPage:true});
  ingest=spawn(process.execPath,["scripts/ingest-worker.mjs"],{env,stdio:"ignore"});
  await page.getByRole("button",{name:"EDITAR VIDEO AUTOMÁTICAMENTE",exact:true}).click();await page.locator('input[type="file"][accept*="video/mp4"]').first().setInputFiles(path.resolve("artifacts/video-autoedit/original.mp4"));
  await page.getByRole("button",{name:"Subir y analizar",exact:true}).first().click();await page.getByText(/Original guardado:/).waitFor({timeout:60000});
  await page.getByLabel("Subtítulos blancos con borde oscuro, sin karaoke",{exact:true}).uncheck();
  const editing=page.waitForResponse(r=>r.url().endsWith("/api/media/jobs")&&r.request().method()==="POST");await page.getByRole("button",{name:"Edición automática",exact:true}).click();const editJob=(await (await editing).json()).job;
  await page.close();await worker();page=await context.newPage();await page.goto(base);article=page.getByRole("region",{name:"Mis videos",exact:true}).locator("article").first();await article.getByText(/READY/).waitFor();
  const edited=await (await fetch(`${base}/api/media/jobs/${editJob.id}`)).json();assert.equal(edited.job.status,"READY");assert.ok(edited.job.result.cuts.removedSeconds>2);
  const gettingEdit=page.waitForEvent("download");await article.getByRole("link",{name:"Descargar MP4"}).click();await (await gettingEdit).saveAs(path.join(output,"browser-edited.mp4"));
  const editValidation=await validateMp4(path.join(output,"browser-edited.mp4"),{requireAudio:true,width:360,height:640});
  // Restart the HTTP process with the same persistent storage; completed jobs and bytes must survive.
  next.kill("SIGTERM");await new Promise(r=>next.once("exit",r));
  const restarted=spawn(process.execPath,["node_modules/next/dist/bin/next","start","-p","3113"],{env,stdio:"ignore"});
  try{for(let i=0;i<100;i++){try{const r=await fetch(`${base}/api/media/jobs/${storyJob.id}`);if(r.ok){assert.equal((await r.json()).job.status,"READY");break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    const response=await fetch(`${base}${history.job.result.downloadUrl}`);assert.equal(response.status,200);assert.ok(response.headers.get("content-disposition").includes("attachment"));assert.equal((await response.arrayBuffer()).byteLength,storyValidation.sizeBytes);
  }finally{restarted.kill("SIGTERM");}
  assert.equal(PUBLISHING_ENABLED,false);
  const evidence={passed:true,client:"Chromium with Pixel 5 Android browser emulation; physical Android device not tested",storyValidation,editValidation,browserClosedDuringRender:true,httpRestartPersisted:true,rangePlayback:true,actualBrowserPlayback:true,publishing:"OFF"};await writeFile(path.join(output,"evidence.json"),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
  }
}catch(error){if(page&&!page.isClosed()){await page.screenshot({path:path.join(output,"failure.png"),fullPage:true});console.error("Browser page:",page.url(),(await page.locator("body").innerText()).slice(0,2000));}console.error("Server diagnostics:",log.slice(-2000));throw error;}
finally{ingest?.kill("SIGTERM");next.kill("SIGTERM");await browser?.close();await rm(storage,{recursive:true,force:true});}
