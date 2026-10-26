import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {mkdir,readFile,writeFile,link,rename} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {RenderService} from '../services/clip/RenderService.mjs';
import {withMediaExecution} from '../lib/media-execution.mjs';

const arg=name=>process.argv.find(a=>a.startsWith('--'+name+'='))?.slice(name.length+3);
if(process.argv.includes('--one')){
  const input=JSON.parse(await readFile(arg('input'),'utf8'));process.env.CLIPFORGE_STORAGE_DIR=input.root;
  const renderer=new RenderService({width:input.width,height:input.height}),started=performance.now();
  const result=await renderer.renderClip(input);
  const firstRenderSeconds=(performance.now()-started)/1000;
  let encoderStarts=0;
  const recovered=await withMediaExecution(new AbortController().signal,()=>renderer.renderClip(input),event=>{if(event.encoder)encoderStarts++;});
  const outputPath=path.join(input.root,result.relativePath),partial=path.join(path.dirname(outputPath),'render.partial.mp4');
  await rename(outputPath,partial);
  const recoveredPartial=await withMediaExecution(new AbortController().signal,()=>renderer.renderClip(input),event=>{if(event.encoder)encoderStarts++;});
  await writeFile(arg('result'),JSON.stringify({width:result.width,height:result.height,quality:input.clip.edit.quality,
    duration:result.validation.duration,sizeBytes:result.sizeBytes,sha256:result.sha256,validation:result.validation,
    firstRenderSeconds,totalWithRecoveryChecksSeconds:(performance.now()-started)/1000,encoderRestartsDuringRecovery:encoderStarts,
    finalReused:recovered.recoveredWithoutEncoding,completePartialRecovered:recoveredPartial.recoveredWithoutEncoding}));
}else{
  if(!process.argv.includes('--rights-confirmed')||!arg('source'))throw new Error('Indica un vídeo real autorizado con --source=archivo --rights-confirmed. Es QA, no un clip entregable.');
  const source=path.resolve(arg('source')),output=path.resolve(arg('output')||'artifacts/render-profiles/'+randomUUID());
  await mkdir(output,{recursive:true});const id=randomUUID(),root=path.join(output,'storage'),relativePath='uploads/'+id+'/source.mp4';
  await mkdir(path.dirname(path.join(root,relativePath)),{recursive:true});await link(source,path.join(root,relativePath));
  const rows=[];
  for(const width of [720,1080])for(const quality of ['BALANCED','EFFICIENT']){
    const name=width+'-'+quality,folder=path.join(output,name),height=width===720?1280:1920;await mkdir(folder,{recursive:true});
    const input={root,width,height,project:{id,source:{relativePath,hasAudio:true}},
      clip:{id:randomUUID(),startTime:50,duration:8,edit:{framingMode:'FIT',quality,subtitlesEnabled:false},subtitles:null}};
    const inputPath=path.join(folder,'input.json'),resultPath=path.join(folder,'result.json'),timePath=path.join(folder,'resources.json');
    await writeFile(inputPath,JSON.stringify(input));const started=performance.now();
    await new Promise((resolve,reject)=>{
      const measure='import json,resource,subprocess,sys,time; begin=time.monotonic(); p=subprocess.run(sys.argv[2:]); r=resource.getrusage(resource.RUSAGE_CHILDREN); open(sys.argv[1],"w").write(json.dumps(dict(maxRssKiB=r.ru_maxrss,userSeconds=r.ru_utime,systemSeconds=r.ru_stime,elapsedSeconds=time.monotonic()-begin))); sys.exit(p.returncode)';
      const child=spawn('python3',['-c',measure,timePath,process.execPath,import.meta.filename,'--one','--input='+inputPath,'--result='+resultPath],{stdio:['ignore','ignore','pipe'],env:process.env});
      let stderr='';child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-2000);});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Benchmark falló: '+stderr)));
    });
    rows.push({...JSON.parse(await readFile(resultPath,'utf8')),resources:JSON.parse(await readFile(timePath,'utf8')),wallSeconds:(performance.now()-started)/1000});
  }
  const evidence={checkedAt:new Date().toISOString(),source:'AUTHORIZED_EXISTING_STREAM_RECORDING',purpose:'TECHNICAL_RENDER_BENCHMARK_ONLY',
    synthetic:false,newStreamerDeliverables:0,r2Writes:0,hostCpuCount:os.availableParallelism(),hostMemoryGiB:os.totalmem()/1024**3,
    node:process.version,renderThreads:Number(process.env.CLIPFORGE_RENDER_THREADS||2),cpuLimited:false,renderHostingMeasured:false,
    memoryMetric:'Maximum RSS of an individual child process; not aggregate server memory.',rows};
  await writeFile(path.join(output,'evidence.json'),JSON.stringify(evidence,null,2));
  console.log(JSON.stringify(evidence));
}
