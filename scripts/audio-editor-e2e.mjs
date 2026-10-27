// Real audio-only acceptance. Requires an existing authorized source. Nothing
// is synthesized, downloaded, published or installed by this script.
import assert from 'node:assert/strict';
import path from 'node:path';
import {spawn,execFileSync} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,mkdir,open,readFile,writeFile} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {chromium} from 'playwright';
import {hashFile} from '../services/ingest/ResumableUploadStore.mjs';
import {loadProjectFile} from '../lib/project-files.mjs';
import {validateMp4} from '../services/media-processing/MediaValidationService.mjs';
import {ClipLibraryService} from '../services/storage/ClipLibraryService.mjs';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';

if(!process.argv.includes('--rights-confirmed')||!process.env.CLIPFORGE_TEST_AUDIO||!process.env.CLIPFORGE_TEST_SOURCE_URL)throw new Error('Configure authorized audio, its public provenance and --rights-confirmed.');
const source=process.env.CLIPFORGE_TEST_AUDIO,cloud=process.env.CLIPFORGE_RUN_R2_TESTS==='true';
const parent=path.resolve('artifacts/completion-20261027');await mkdir(parent,{recursive:true});
const resume=process.argv.find(a=>a.startsWith('--resume-run='))?.slice(13);
const run=resume?path.resolve(resume):await mkdtemp(path.join(parent,'audio-'));
if(!run.startsWith(parent+path.sep))throw new Error('Acceptance directory is outside the allowed root.');
const storage=path.join(run,'storage'),port=Number(process.env.CLIPFORGE_TEST_PORT||3178),base=`http://127.0.0.1:${port}`;
const accessKey=randomBytes(32).toString('hex'),sessionKey=randomBytes(32).toString('hex');
const env={...process.env,PORT:String(port),RENDER:'true',CLIPFORGE_REQUIRE_OWNER_AUTH:'true',CLIPFORGE_OWNER_ACCESS_KEY:accessKey,CLIPFORGE_SESSION_KEY:sessionKey,
  CLIPFORGE_STORAGE_DIR:storage,CLIPFORGE_RUNTIME_HOME:path.join(storage,'.runtime-home'),CLIPFORGE_RELEASE_CHANNEL:'stable',CLIPFORGE_EXPERIMENTAL_FEATURES:'false',
  CLIPFORGE_AGENT_ENABLED:'false',CLIPFORGE_AGENT_REAL_PUBLISHING:'false',CLIPFORGE_CONTENT_REAL_PUBLISHING:'false',CLIPFORGE_SMART_PUBLISH_ON_BOOT:'false',
  CLIPFORGE_LIVE_MONITOR_ENABLED:'false',CLIPFORGE_LIVE_CAPTURE_ENABLED:'false',CLIPFORGE_STORAGE_RETENTION_ENABLED:'false',CLIPFORGE_PROJECT_BACKUP_ENABLED:'false',
  CLIPFORGE_MEDIA_STORAGE_PROVIDER:cloud?'r2':'local',CLIPFORGE_REDIS_URL:'',REDIS_URL:'',VERCEL:'',VERCEL_ENV:'',CLIPFORGE_CONTENT_RUNTIME_URL:'',CLIPFORGE_ANALYSIS_PROVIDER:'heuristic',
  CLIPFORGE_MEDIA_WIDTH:'720',CLIPFORGE_MEDIA_HEIGHT:'1280',CLIPFORGE_RENDER_THREADS:'1',CLIPFORGE_ZAI_API_KEY:'',ZAI_API_KEY:'',OPENAI_API_KEY:'',CLIPFORGE_AI_API_KEY:''};
const log=await open(path.join(run,`runtime-${Date.now()}.log`),'w');
const server=spawn(process.execPath,['scripts/render-runtime-free.mjs'],{env,stdio:['ignore',log.fd,log.fd]});
let browser,stage='BOOT',peakRssKiB=0;
const sampler=setInterval(()=>{try{const rows=execFileSync('ps',['-eo','pid=,ppid=,rss='],{encoding:'utf8'}).trim().split('\n').map(row=>row.trim().split(/\s+/u).map(Number));const ids=new Set([server.pid]);let changed=true;while(changed){changed=false;for(const [pid,ppid]of rows)if(ids.has(ppid)&&!ids.has(pid)){ids.add(pid);changed=true;}}peakRssKiB=Math.max(peakRssKiB,rows.filter(row=>ids.has(row[0])).reduce((sum,row)=>sum+row[2],0));}catch{}},500);
async function waitUntil(fn,seconds=180){for(let i=0;i<seconds;i++){const value=await fn();if(value)return value;await delay(1000);}throw new Error('ACCEPTANCE_TIMEOUT');}
async function retryStorage(operation){for(let i=0;i<6;i++){try{return await operation();}catch(error){if(!['STORAGE_BUSY','STORAGE_CONFLICT'].includes(error.code)||i===5)throw error;await delay(Math.min(8000,1000*2**i));}}}
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const evidence={checkedAt:new Date().toISOString(),sourceSha256:await hashFile(source),sourceUrl:process.env.CLIPFORGE_TEST_SOURCE_URL,sourceOffset:Number(process.env.CLIPFORGE_TEST_SOURCE_OFFSET||0),
  apiMocks:false,synthetic:false,publicDeployment:false,physicalAndroid:false,externalAiCalls:0,resumed:Boolean(resume)};
async function audioCorrelation(filename,clip){
  const decode=(input,start)=>execFileSync(process.env.FFMPEG_PATH||'ffmpeg',['-v','error','-ss',String(start),'-i',input,'-t',String(clip.duration),'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1'],{maxBuffer:8*1024**2});
  const a=decode(source,clip.startTime),b=decode(filename,0),n=Math.min(a.length,b.length)/4;let aa=0,bb=0,ab=0;
  for(let i=0;i<n;i++){const x=a.readFloatLE(i*4),y=b.readFloatLE(i*4);aa+=x*x;bb+=y*y;ab+=x*y;}
  return{samples:n,correlation:ab/Math.sqrt(aa*bb),alignedAtOriginalInterval:true};
}
try{
  await waitUntil(async()=>{try{return(await fetch(base+'/api/health')).ok;}catch{return false;}},90);
  const anonymousStatus=(await fetch(base+'/api/projects')).status;evidence.anonymousStatus=anonymousStatus;assert.equal(anonymousStatus,401);
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY,proxy=proxyUrl?{server:new URL(proxyUrl).origin,bypass:'127.0.0.1,localhost'}:undefined;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',args:['--no-sandbox'],proxy});
  const context=await browser.newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true,acceptDownloads:true,proxy});
  let page=await context.newPage();await page.goto(base);await page.getByLabel('Clave de acceso',{exact:true}).fill(accessKey);await page.getByRole('button',{name:'Entrar',exact:true}).click();
  process.env.CLIPFORGE_STORAGE_DIR=storage;
  let project;
  if(resume){const previous=JSON.parse(await readFile(path.join(run,'checkpoint.json'),'utf8'));project=await loadProjectFile(previous.projectId);await page.getByRole('button',{name:'Abrir proyecto',exact:true}).filter({visible:true}).first().click();}
  else{
    stage='AUDIO_UPLOAD';const form=page.locator('#clipforge-upload-panel');await form.locator('input[type=file]').setInputFiles(source);await form.getByRole('button',{name:'Subir video',exact:true}).click();
    await page.getByRole('region',{name:'Recorte manual'}).waitFor({timeout:60000});const projects=await(await context.request.get(base+'/api/projects')).json();assert.equal(projects.projects.length,1);
    project=await loadProjectFile(projects.projects[0].id);await writeFile(path.join(run,'checkpoint.json'),JSON.stringify({projectId:project.id}));
  }
  assert.equal(project.source.mediaKind,'AUDIO');assert.equal(await hashFile(path.join(storage,project.source.relativePath)),evidence.sourceSha256);
  const region=page.getByRole('region',{name:'Recorte manual'});await region.waitFor();assert.equal(await region.getByLabel('Resolución del recorte',{exact:true}).count(),0);
  const original=page.locator('#clipforge-upload-panel audio').first();await original.evaluate(async node=>{node.muted=true;await node.play();});await delay(400);assert.ok(await original.evaluate(node=>node.currentTime)>0);await original.evaluate(node=>node.pause());
  const started=Date.now();let clip=project.clips?.find(c=>c.candidateId.startsWith('manual-'));
  if(!clip){stage='AUDIO_RENDER';await region.getByLabel('Inicio del fragmento en segundos',{exact:true}).fill('10');await region.getByLabel('Final del fragmento en segundos',{exact:true}).fill('28');await region.getByRole('checkbox').check();await region.getByRole('button',{name:'Generar M4A del fragmento',exact:true}).click();await page.close();
    clip=await waitUntil(async()=>{project=await loadProjectFile(project.id);const c=project.clips?.find(c=>c.candidateId.startsWith('manual-'));if(c?.status==='FAILED')throw new Error('AUDIO_RENDER_FAILED');return c?.status==='READY'?c:false;});
    page=await context.newPage();await page.goto(base);await page.getByRole('button',{name:'Abrir proyecto',exact:true}).first().click();
  }
  const initialSha=await hashFile(path.join(storage,clip.render.relativePath));evidence.manualSeconds=(Date.now()-started)/1000;
  const card=page.getByRole('article',{name:'Resultado del recorte manual'}).filter({has:page.getByRole('link',{name:'Descargar recorte M4A',exact:true})}).first();await card.waitFor();
  if(!clip.subtitles){stage='AUDIO_ASR_TRANSLATION';await card.getByText('Glosario de traducción del proyecto',{exact:true}).click();await card.getByLabel('Glosario de traducción',{exact:true}).fill('NASA = NASA');await card.getByRole('button',{name:'Guardar glosario',exact:true}).click();
    await card.getByLabel('Idioma de subtítulos',{exact:true}).selectOption('TRANSLATE_ES');await card.getByRole('button',{name:'Aplicar idioma y renderizar',exact:true}).click();
    clip=await waitUntil(async()=>{const p=await loadProjectFile(project.id),c=p.clips.find(c=>c.id===clip.id);if(c.status==='FAILED')throw new Error('AUDIO_CAPTIONS_FAILED');return c.status==='READY'&&c.subtitles?c:false;},300);
  }
  assert.equal(clip.subtitles.language,'es');assert.equal(clip.subtitles.reviewStatus,'REVIEW_REQUIRED');assert.equal(await hashFile(path.join(storage,clip.render.relativePath)),initialSha,'Caption changes must not re-encode unchanged audio');
  stage='AUDIO_HISTORY';await page.reload();await page.getByRole('button',{name:'Abrir proyecto',exact:true}).first().click();
  if(!clip.subtitleHistory?.length){const cue=clip.subtitles.cues[0];await card.getByLabel(`Texto del subtítulo ${cue.id}`,{exact:true}).fill(cue.text.toLocaleUpperCase('es'));await card.getByRole('button',{name:'Guardar y volver a renderizar',exact:true}).click();
    clip=await waitUntil(async()=>{const p=await loadProjectFile(project.id),c=p.clips.find(c=>c.id===clip.id);return c.status==='READY'&&c.subtitleHistory?.length?c:false;});
  }
  const previous=clip.subtitleHistory[0];const historical=await context.request.get(`${base}/api/projects/${project.id}/clips/${clip.id}/subtitles?format=srt&version=${previous.versionId}`);assert.equal(historical.status(),200);
  await card.locator('summary').filter({hasText:'Historial de subtítulos'}).click();await card.getByRole('button',{name:'Restaurar esta versión',exact:true}).first().click();
  clip=await waitUntil(async()=>{const p=await loadProjectFile(project.id),c=p.clips.find(c=>c.id===clip.id);return c.status==='READY'&&c.subtitles.cues[0].text===previous.track.cues[0].text?c:false;});
  assert.equal(await hashFile(path.join(storage,clip.render.relativePath)),initialSha);assert.equal(clip.startTime,10);assert.equal(clip.endTime,28);
  const sourceResponse=await context.request.get(base+clip.render.sourceUrl+'?download=1');assert.equal(sourceResponse.headers()['content-type'],'audio/mp4');assert.match(sourceResponse.headers()['content-disposition'],/\.m4a/);assert.equal(digest(await sourceResponse.body()),initialSha);
  const srt=await context.request.get(`${base}/api/projects/${project.id}/clips/${clip.id}/subtitles?format=srt`);assert.equal(srt.status(),200);await writeFile(path.join(run,'audio-es.srt'),await srt.body());
  const validation=await validateMp4(path.join(storage,clip.render.relativePath),{audioOnly:true,duration:18});assert.equal(validation.width,0);
  const correlation=await audioCorrelation(path.join(storage,clip.render.relativePath),clip);assert.ok(correlation.correlation>.98);
  await page.screenshot({path:path.join(run,'audio-mobile.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
  evidence.projectId=project.id;evidence.clipId=clip.id;evidence.sha256=initialSha;evidence.validation=validation;evidence.audioProof=correlation;evidence.captionHistoryCount=clip.subtitleHistory.length;evidence.tabClosedDuringProcessing=!resume;evidence.captionUpdateReusedAudio=true;
  if(cloud){stage='R2_AUDIO_RECOVERY';project=await loadProjectFile(project.id);const library=new ClipLibraryService();const saved=await retryStorage(()=>library.archive(project,clip,{root:storage}));await retryStorage(()=>library.setKeep(saved.id,true));
    const response=await context.request.get(`${base}/api/media/library/${saved.id}/source?download=1`);assert.equal(response.status(),200);assert.equal(response.headers()['content-type'],'audio/mp4');assert.equal(digest(await response.body()),initialSha);
    const access=await context.request.post(`${base}/api/media/library/${saved.id}/access`);assert.equal(access.status(),200);const signed=await access.json();const remote=await context.request.get(signed.url);assert.equal(remote.status(),200);assert.match(remote.headers()['content-disposition'],/\.m4a/);assert.equal(digest(await remote.body()),initialSha);
    const recovery=new ProjectRecoveryService({root:storage});const checkpoint=await retryStorage(()=>recovery.backup(project.id));const target=path.join(run,'restored');await recovery.restore(project.id,{targetRoot:target});
    const restored=JSON.parse(await readFile(path.join(target,'projects',project.id+'.json'),'utf8'));assert.deepEqual(restored.clips[0].subtitleHistory,project.clips[0].subtitleHistory);assert.deepEqual(restored.translationSettings,project.translationSettings);assert.equal(await hashFile(path.join(target,clip.render.relativePath)),initialSha);
    evidence.r2={archiveId:saved.id,downloadHashMatched:true,renewedLinkDownloaded:true,checkpointHash:checkpoint.snapshotHash,restoredHashMatched:true};
  }
  evidence.status='PASSED';evidence.peakProcessTreeRssKiB=peakRssKiB;evidence.memoryMethod='SUM_OF_PROCESS_TREE_RSS_INCLUDING_SHARED_PAGES_NOT_CGROUP_PEAK';
  evidence.realAsr=(await loadProjectFile(project.id)).transcript?.provider;await writeFile(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify({status:'PASSED',run,sha256:initialSha,r2:cloud}));
}catch(error){evidence.status='FAILED';evidence.failedStage=stage;evidence.errorCode=error.code||'ACCEPTANCE_FAILED';evidence.diagnostic=String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu,'[URL_REDACTED]').replace(/[a-f0-9]{32,}/giu,'[HASH_OR_SECRET_REDACTED]').slice(0,350);const pages=browser?.contexts()[0]?.pages()||[];await pages.at(-1)?.screenshot({path:path.join(run,'failure-mobile.png'),fullPage:true}).catch(()=>{});await writeFile(path.join(run,'evidence.json'),JSON.stringify(evidence,null,2));console.error(JSON.stringify({status:'FAILED',stage,run,errorCode:evidence.errorCode,diagnostic:evidence.diagnostic}));process.exitCode=1;}
finally{clearInterval(sampler);await browser?.close();server.kill('SIGTERM');await Promise.race([once(server,'exit'),delay(8000)]);await log.close();}
