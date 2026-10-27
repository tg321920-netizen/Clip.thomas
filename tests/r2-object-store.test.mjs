import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { R2ObjectStore, readR2Config } from '../services/storage/R2ObjectStore.mjs';

const config = { accountId: 'a'.repeat(32), bucket: 'fixture-private-clips', accessKeyId: 'fixture-access-id', secretAccessKey: 'fixture-secret-not-an-actual-credential' };

test('large project snapshots need an explicit bounded reader; normal records retain the 2 MB limit',async()=>{
  const bytes=Buffer.from(JSON.stringify({text:'x'.repeat(2_100_000)}));
  const store=new R2ObjectStore({config,customFetch:async()=>new Response(bytes,{status:200,headers:{ETag:'"bounded-large"'}})});
  await assert.rejects(store.getJson('large.json'),{code:'STORAGE_INVALID'});
  const result=await store.getJson('large.json',{maximumBytes:16*1024**2});assert.equal(result.value.text.length,2_100_000);
  await assert.rejects(store.getJson('large.json',{maximumBytes:32*1024**2}),{code:'STORAGE_INVALID'});
});

test('R2 S3 SDK signs a streaming PUT with checksum and conditional creation on the fixed HTTPS origin', async () => {
  const bytes = Buffer.from('fixture stream payload'); let calls = 0;
  const store = new R2ObjectStore({ config, customFetch: async request => {
    calls++;
    assert.equal(request.method, 'PUT');
    assert.equal(new URL(request.url).hostname, `${config.accountId}.r2.cloudflarestorage.com`);
    assert.equal(new URL(request.url).protocol, 'https:');
    assert.equal(request.headers.get('if-none-match'), '*');
    assert.equal(request.headers.get('content-md5'), createHash('md5').update(bytes).digest('base64'));
    assert.match(request.headers.get('authorization'), /^AWS4-HMAC-SHA256 /);
    assert.ok(!request.headers.get('authorization').includes(config.secretAccessKey));
    assert.deepEqual(Buffer.from(await request.arrayBuffer()), bytes);
    return new Response(null, { status: 200, headers: { ETag: '"fixture-etag"' } });
  } });
  const result = await store.put('clipforge-managed/v1/media/fixture.mp4', Readable.from([bytes]), { length: bytes.length, md5: createHash('md5').update(bytes).digest('base64'), ifAbsent: true });
  assert.equal(result.etag, '"fixture-etag"'); assert.equal(calls, 1);
  assert.ok(!JSON.stringify(store).includes(config.secretAccessKey));
});

test('SDK range responses are streamed and JSON compare-and-swap headers are preserved', async () => {
  const store = new R2ObjectStore({ config, customFetch: async request => {
    if (request.method === 'GET') {
      assert.equal(request.headers.get('range'), 'bytes=1-3');
      assert.equal(request.headers.get('if-match'), '"v1"');
      return new Response(Buffer.from('bcd'), { status: 206, headers: { 'Content-Length': '3', 'Content-Range': 'bytes 1-3/6', ETag: '"v1"' } });
    }
    assert.equal(request.headers.get('if-match'), '"v1"');
    assert.deepEqual(await request.json(), { keep: true });
    return new Response(null, { status: 200, headers: { ETag: '"v2"' } });
  } });
  const result = await store.get('fixture', { range: 'bytes=1-3', ifMatch: '"v1"' });
  const chunks = []; for await (const chunk of result.body) chunks.push(chunk);
  assert.equal(Buffer.concat(chunks).toString(), 'bcd'); assert.equal(result.contentRange, 'bytes 1-3/6');
  assert.equal((await store.putJson('record', { keep: true }, { ifMatch: '"v1"' })).etag, '"v2"');
});

test('S3 access errors are sanitized, missing objects are explicit and preconditions do not silently overwrite', async () => {
  for (const [status, expected] of [[403, 'STORAGE_UNAVAILABLE'], [412, 'STORAGE_CONFLICT'], [404, null]]) {
    let calls = 0;
    const store = new R2ObjectStore({ config, customFetch: async () => {
      calls++; return new Response(`<Error><Code>${status === 404 ? 'NoSuchKey' : status === 412 ? 'PreconditionFailed' : 'AccessDenied'}</Code><Message>${config.secretAccessKey}</Message></Error>`, { status, headers: { 'Content-Type': 'application/xml' } });
    } });
    if (expected) await assert.rejects(store.head('fixture'), error => error.code === expected && !error.message.includes(config.secretAccessKey));
    else assert.equal(await store.head('fixture'), null);
    assert.equal(calls, 1);
  }
  const missingBucket = new R2ObjectStore({ config, customFetch: async () => new Response('<Error><Code>NoSuchBucket</Code></Error>', { status: 404, headers: { 'Content-Type': 'application/xml' } }) });
  await assert.rejects(missingBucket.list(), error => error.code === 'STORAGE_UNAVAILABLE');
  await assert.rejects(missingBucket.get('fixture'), error => error.code === 'STORAGE_UNAVAILABLE');
});

test('R2 configuration rejects injected endpoints and malformed bucket/account identifiers', () => {
  assert.equal(readR2Config({}), null);
  const env = { CLIPFORGE_MEDIA_STORAGE_PROVIDER: 'r2', CLIPFORGE_R2_ACCOUNT_ID: config.accountId, CLIPFORGE_R2_BUCKET: config.bucket, CLIPFORGE_R2_ACCESS_KEY_ID: config.accessKeyId, CLIPFORGE_R2_SECRET_ACCESS_KEY: config.secretAccessKey };
  assert.deepEqual(readR2Config(env), config);
  assert.throws(() => readR2Config({ ...env, CLIPFORGE_R2_ACCOUNT_ID: 'localhost:8000' }));
  assert.throws(() => readR2Config({ ...env, CLIPFORGE_R2_BUCKET: '../outside' }));
});

test('R2 requests identity encoding so JSON versions remain usable for conditional updates', async () => {
  let calls=0;
  const store=new R2ObjectStore({config,customFetch:async request=>{
    calls++;
    assert.equal(request.headers.get('accept-encoding'),'identity');
    if(request.method==='GET')return new Response(JSON.stringify({keep:false}),{status:200,headers:{ETag:'"canonical-v1"','Content-Type':'application/json'}});
    assert.equal(request.headers.get('if-match'),'"canonical-v1"');
    assert.deepEqual(await request.json(),{keep:true});
    return new Response(null,{status:200,headers:{ETag:'"canonical-v2"'}});
  }});
  const record=await store.getJson('record.json');
  assert.equal((await store.putJson('record.json',{keep:true},{ifMatch:record.etag})).etag,'"canonical-v2"');
  assert.equal(calls,2);
});

test('weak JSON validators fail closed instead of being stripped and used to overwrite a record', async () => {
  let calls=0;
  const store=new R2ObjectStore({config,customFetch:async()=>{
    calls++;return new Response('{"keep":true}',{status:200,headers:{ETag:'W/"compressed"'}});
  }});
  await assert.rejects(()=>store.getJson('record.json'),error=>error.code==='STORAGE_UNAVAILABLE');
  await assert.rejects(()=>store.putJson('record.json',{keep:false},{ifMatch:'W/"compressed"'}),error=>error.code==='STORAGE_INVALID');
  assert.equal(calls,1);
});
