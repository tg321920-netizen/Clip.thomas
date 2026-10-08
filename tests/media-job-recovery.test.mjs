import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp,rm,utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { JobStore } from "../services/JobStore.mjs";
test("a killed worker is recovered once and a live worker lease is never stolen",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"clipforge-real-restart-"));const previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;let child;
  try{
    const store=new JobStore({staleAfterMs:1,renderStaleAfterMs:1});const queued=await store.enqueueMedia("MEDIA_STORY",randomUUID(),{topic:"owned test"});
    const childEnv={...process.env,CLIPFORGE_STORAGE_DIR:root};delete childEnv.NODE_TEST_CONTEXT;
    child=spawn(process.execPath,["--input-type=module","-e","import {JobStore} from './services/JobStore.mjs';const store=new JobStore();const job=await store.claimNext(['MEDIA_STORY']);await store.transition(job.id,'VALIDATING','MEDIA_VALIDATION',95);process.stdout.write(job.id+'\\n');setInterval(()=>{},1000);"],{cwd:process.cwd(),env:childEnv,stdio:["ignore","pipe","pipe"]});
    for(let attempt=0;attempt<100;attempt++){if((await store.get(queued.id)).status==="VALIDATING")break;await new Promise(resolve=>setTimeout(resolve,25));}
    assert.equal((await store.get(queued.id)).status,"VALIDATING","The child worker must persist its real claim before termination");
    const old=new Date(Date.now()-60000);await utimes(path.join(root,"jobs",`${queued.id}.lock`),old,old);
    assert.equal(await store.claimNext(["MEDIA_STORY"]),null,"A live renderer keeps its lock even after a stale mtime");
    child.kill("SIGKILL");await once(child,"exit");child=null;
    const recovered=await new JobStore().claimNext(["MEDIA_STORY"]);assert.equal(recovered.id,queued.id);assert.equal(recovered.attempts,2);assert.ok(recovered.history.some(h=>h.stage==="RECOVERED"));
    assert.equal(await new JobStore().claimNext(["MEDIA_STORY"]),null,"Recovery must not duplicate the active render");
    await store.fail(recovered,new Error("controlled test termination"),{retryable:false});
  }finally{child?.kill("SIGKILL");if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});}
});
test("READY rejects absent files even if supplied metadata claims validation",async()=>{
  const root=await mkdtemp(path.join(os.tmpdir(),"clipforge-no-false-ready-"));const previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  try{const store=new JobStore();const queued=await store.enqueueMedia("MEDIA_STORY",randomUUID(),{});const claimed=await store.claimNext(["MEDIA_STORY"]);await assert.rejects(()=>store.complete({...claimed,result:{relativePath:"missing.mp4",validation:{valid:true}}}));assert.notEqual((await store.get(queued.id)).status,"READY");await store.release(queued.id);}
  finally{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});}
});
