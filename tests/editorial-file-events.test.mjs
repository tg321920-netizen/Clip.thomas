import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {EditorialEventStore} from '../services/analysis/EditorialEventStore.mjs';

test('uploaded podcasts deduplicate by source bytes and intervals across batches and recovered project checkpoints',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cf-file-events-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source={channelId:'FILE',sourceId:'a'.repeat(64),sourceKind:'FILE'},store=new EditorialEventStore({root});
  const candidate={id:'one',startTime:10,endTime:40,text:'A meaningful question and its complete answer about an important decision.'};
  assert.equal(await store.reserve(source,candidate,'owner-one'),true);await store.confirm(source,'one','owner-one');
  assert.equal(await store.reserve(source,{...candidate,id:'different-asr',startTime:12,endTime:42,text:'Slightly different recognition.'},'owner-two'),false);
  assert.equal(await store.reserve({...source,sourceId:'b'.repeat(64)},candidate,'another-source'),true);
  const newRoot=path.join(root,'new-instance'),fresh=new EditorialEventStore({root:newRoot});
  await fresh.recoverFileProjects(source,[{id:'owner-one',clipsOrigin:{sourceSha256:source.sourceId},analysis:{candidates:[candidate]},clips:[{id:'clip-one',candidateId:'one',status:'READY',startTime:10,endTime:40,render:{validation:{valid:true}}}]}]);
  assert.equal(await fresh.reserve(source,{...candidate,id:'later'},'owner-new'),false);
  assert.equal(await fresh.reserve(source,{id:'independent',startTime:70,endTime:100,text:'An unrelated story with its own conclusion.'},'owner-new'),true);
});
