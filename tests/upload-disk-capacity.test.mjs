import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';import os from 'node:os';
import {createHash} from 'node:crypto';
import {ResumableUploadStore} from '../services/ingest/ResumableUploadStore.mjs';

test('low disk rejects new chunks and assembly without losing committed chunks',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'clipforge-upload-space-'));t.after(()=>rm(root,{recursive:true,force:true}));
  let available=1024**3;
  const store=new ResumableUploadStore({root,availableBytes:async()=>available});
  const bytes=Buffer.from('actual-bytes-for-storage-contract-only'),hash=createHash('sha256').update(bytes).digest('hex');
  const session=await store.create({filename:'test.mp4',mimeType:'video/mp4',size:bytes.length});
  available=0;
  await assert.rejects(store.putChunk(session.id,session.token,0,ReadableStream.from([bytes]),hash),{code:'UPLOAD_DISK_FULL',status:507});
  assert.deepEqual((await store.status(session.id,session.token)).received,[]);
  available=1024**3;await store.putChunk(session.id,session.token,0,ReadableStream.from([bytes]),hash);
  available=0;let enqueued=false;
  await assert.rejects(store.finalize(session.id,session.token,async()=>{enqueued=true;}),{code:'UPLOAD_DISK_FULL'});
  assert.equal(enqueued,false);assert.deepEqual((await store.status(session.id,session.token)).received,[0]);
  available=1024**3;await store.finalize(session.id,session.token,async()=>{enqueued=true;});assert.equal(enqueued,true);
});
