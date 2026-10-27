// Deterministic process/metadata stubs test state preservation only. They are
// not captured media and do not count as live or audiovisual acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile, readdir, rm, writeFile, access} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {captureSegmentedStream} from '../services/ingest/UrlIngestService.mjs';

async function fixture(action) {
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-recovery-state-'));
  const original={FFMPEG_PATH:process.env.FFMPEG_PATH,FFPROBE_PATH:process.env.FFPROBE_PATH};
  const directory=path.join(root,'capture'),parts=path.join(directory,'.stream-parts');
  await mkdir(parts,{recursive:true});
  const source=Buffer.from('Explicit state-test stub; not real audiovisual media.');
  await writeFile(path.join(parts,'part-000000.ts'),source);
  const probe=path.join(root,'probe-stub');
  const metadata={format:{duration:'6'},streams:[{codec_type:'video',width:64,height:64,codec_name:'h264',duration:'6'},{codec_type:'audio',codec_name:'aac',duration:'6'}]};
  await writeFile(probe,`#!/usr/bin/env node\nconsole.log(${JSON.stringify(JSON.stringify(metadata))});\n`,{mode:0o700});
  process.env.FFPROBE_PATH=probe;
  const executable=async (name,body)=>{const file=path.join(root,name);await writeFile(file,`#!/usr/bin/env node\n${body}\n`,{mode:0o700});return file;};
  try {await action({root,directory,parts,source,executable});}
  finally {for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}await rm(root,{recursive:true,force:true});}
}

async function assertPreserved(parts,source) {
  assert.deepEqual(await readFile(path.join(parts,'part-000000.ts')),source);
  assert.deepEqual((await readdir(parts)).filter(name=>name.includes('.invalid-')),[]);
}

test('cancelling while revalidating retained capture bytes must not label them corrupt',async()=>{
  await fixture(async({root,directory,parts,source,executable})=>{
    const ready=path.join(root,'decoder-started');
    process.env.FFMPEG_PATH=await executable('decoder-wait',`require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`);
    const controller=new AbortController();
    const work=captureSegmentedStream({url:'/authorized-state-fixture.mp4',uploadDir:directory,captureSeconds:5,signal:controller.signal});
    work.catch(()=>{});
    try {
      let running=false;for(let i=0;i<100;i++){try{await access(ready);running=true;break;}catch{}await delay(20);}
      assert.equal(running,true);
      controller.abort();
      await assert.rejects(work,error=>error.name==='AbortError');
      await assertPreserved(parts,source);
    } finally {controller.abort();await work.catch(()=>{});}
  });
});

test('an unavailable decoder is an environment error, not evidence of corrupted capture bytes',async()=>{
  await fixture(async({root,directory,parts,source})=>{
    process.env.FFMPEG_PATH=path.join(root,'not-installed');
    await assert.rejects(captureSegmentedStream({url:'/authorized-state-fixture.mp4',uploadDir:directory,captureSeconds:5}),{code:'ENOENT'});
    await assertPreserved(parts,source);
  });
});

test('a decoder killed by the operating system preserves retained bytes for retry',async()=>{
  await fixture(async({directory,parts,source,executable})=>{
    process.env.FFMPEG_PATH=await executable('decoder-killed',"process.kill(process.pid,'SIGKILL');");
    await assert.rejects(captureSegmentedStream({url:'/authorized-state-fixture.mp4',uploadDir:directory,captureSeconds:5}),{code:'INGEST_PROCESS_INTERRUPTED'});
    await assertPreserved(parts,source);
  });
});

test('invalid probe output preserves the source instead of guessing its bytes are damaged',async()=>{
  await fixture(async({directory,parts,source,executable})=>{
    process.env.FFPROBE_PATH=await executable('probe-invalid',"console.log('incompatible probe output');");
    await assert.rejects(captureSegmentedStream({url:'/authorized-state-fixture.mp4',uploadDir:directory,captureSeconds:5}),{code:'INGEST_PROBE_INVALID_RESPONSE'});
    await assertPreserved(parts,source);
  });
});

test('cancellation also stops a running probe without quarantining retained bytes',async()=>{
  await fixture(async({root,directory,parts,source,executable})=>{
    const ready=path.join(root,'probe-started');
    process.env.FFPROBE_PATH=await executable('probe-wait',`require('node:fs').writeFileSync(${JSON.stringify(ready)},'ready');setInterval(()=>{},1000);`);
    const controller=new AbortController();
    const work=captureSegmentedStream({url:'/authorized-state-fixture.mp4',uploadDir:directory,captureSeconds:5,signal:controller.signal});work.catch(()=>{});
    try {
      let running=false;for(let i=0;i<100;i++){try{await access(ready);running=true;break;}catch{}await delay(20);}
      assert.equal(running,true);controller.abort();await assert.rejects(work,error=>error.name==='AbortError');
      await assertPreserved(parts,source);
    } finally {controller.abort();await work.catch(()=>{});}
  });
});

test('an actual decoder rejection still quarantines the fragment and never delivers it',async()=>{
  await fixture(async({directory,parts,source,executable})=>{
    process.env.FFMPEG_PATH=await executable('decoder-rejects',"process.stderr.write('Invalid data found when processing input.',()=>process.exit(1));");
    let delivered=0;
    await assert.rejects(captureSegmentedStream({url:'/authorized-state-fixture.mp4',uploadDir:directory,captureSeconds:5,onSegment:()=>{delivered++;}}),/Invalid data/u);
    assert.equal(delivered,0);
    const saved=(await readdir(parts)).filter(name=>name.startsWith('part-000000.ts.invalid-'));assert.equal(saved.length,1);
    assert.deepEqual(await readFile(path.join(parts,saved[0])),source);
  });
});
