import test from 'node:test';import assert from 'node:assert/strict';
import {auditRenderReadOnly} from '../services/deployment/RenderReadOnlyAudit.mjs';
test('missing private Render binding makes no administrative request',async()=>{
  let calls=0;const result=await auditRenderReadOnly({env:{},request:async()=>{calls++;throw new Error('Must not call');}});
  assert.equal(calls,0);assert.equal(result.status,'BLOCKED_MISSING_PRIVATE_BINDING');assert.equal(result.mutations,0);
});
test('read-only Render diagnosis uses only fixed GETs, omits secret values and stops at authentication failure',async()=>{
  const calls=[],secret='explicit-fake-unit-secret',env={RENDER_API_KEY:secret};
  const data=[[{owner:{id:'team-unit',name:'Unit workspace',email:'private-unit@example.invalid'}}],
    [{service:{id:'srv-unit',name:'clipforge-development-preview',ownerId:'team-unit',branch:'preview/frozen',serviceDetails:{plan:'free',env:'node'}}}],
    [{deploy:{status:'live',commit:{id:'a'.repeat(40)}}}], [{envVar:{key:'OWNER_ACCESS_KEY',value:secret}}]];
  const result=await auditRenderReadOnly({env,request:async(url,options)=>{
    calls.push({url,options});assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
    return new Response(JSON.stringify(data[calls.length-1]),{status:200});
  }});
  assert.equal(calls.length,4);assert.ok(calls.every(call=>new URL(call.url).origin==='https://api.render.com'));
  assert.equal(result.status,'READ_ONLY_DIAGNOSIS_COMPLETED');assert.equal(result.mutations,0);
  assert.deepEqual(result.services[0].environmentVariableNames,['OWNER_ACCESS_KEY']);assert.doesNotMatch(JSON.stringify(result),/explicit-fake-unit-secret|private-unit@example/);
  let failures=0;const denied=await auditRenderReadOnly({env,request:async()=>{failures++;return new Response(secret,{status:401});}});
  assert.equal(failures,1);assert.equal(denied.httpStatus,401);assert.doesNotMatch(JSON.stringify(denied),/explicit-fake-unit-secret/);
});
