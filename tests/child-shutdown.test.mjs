import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';
import {stopChildProcesses,childIsRunning} from '../lib/child-shutdown.mjs';

test('a worker ignoring SIGTERM is force-stopped even after ChildProcess.killed becomes true',async t=>{
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000);"],{stdio:['ignore','ignore','ignore','ipc']});
  t.after(()=>{if(childIsRunning(child))child.kill('SIGKILL');});await once(child,'message');
  child.kill('SIGTERM');assert.equal(child.killed,true);assert.equal(childIsRunning(child),true);
  const result=await stopChildProcesses([child],{graceMs:40});assert.equal(result.forced,1);assert.equal(result.remaining,0);assert.equal(child.signalCode,'SIGKILL');
});
