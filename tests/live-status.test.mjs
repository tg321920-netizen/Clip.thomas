import test from 'node:test';
import assert from 'node:assert/strict';
import {liveStatus} from '../services/live/LiveStatusService.mjs';
test('status reads the existing jobs-with-issues contract and never exposes worker payloads or source credentials',async()=>{
 const dirty={id:'job-1',type:'MEDIA_CLIPS',status:'FAILED',stage:'SELECTING',progress:20,payload:{secret:'must-not-leak'},error:'private upstream URL'};
 const status=await liveStatus({sessions:{list:async()=>[],capacity:async()=>({allowed:true})},ingests:{listWithIssues:async()=>({jobs:[],issues:[]})},media:{listMediaWithIssues:async()=>({jobs:[dirty],issues:[{id:'damaged',message:'private metadata'}]})},monitorStore:{read:async()=>({status:'DISABLED'})},resolveStatus:async()=>({status:'OFFLINE',checkedAt:new Date().toISOString()}),env:{}});
 assert.equal(status.mediaJobs.length,1);assert.equal(status.metadataIssueCount,1);assert.equal(status.source.status,'OFFLINE');assert.equal(status.monitor.enabled,false);assert.doesNotMatch(JSON.stringify(status),/must-not-leak|private upstream|private metadata/);
});
