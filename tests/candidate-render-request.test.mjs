import test from 'node:test';import assert from 'node:assert/strict';
import {candidateRenderRequest} from '../lib/candidate-render-request.mjs';
test('retrying an automatic or corrected candidate preserves its exact cut ID and saved output settings',()=>{
  const clip={id:'55d38c52-0292-48b8-b3a2-f44e934ac772',status:'DRAFT',edit:{quality:'EFFICIENT',output:{width:1280,height:720}},subtitles:{manuallyEdited:true}};
  assert.deepEqual(candidateRenderRequest('candidate-0001',clip),{retryClipId:clip.id});
  assert.deepEqual(candidateRenderRequest('candidate-0001'),{candidateId:'candidate-0001',framingMode:'FILL',quality:'BALANCED'});
});
