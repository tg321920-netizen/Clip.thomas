import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createContentAnalysisProvider } from "../services/analysis/createContentAnalysisProvider.mjs";
import { OpenAIContentProvider } from "../services/analysis/OpenAIContentProvider.mjs";
import { requestStructuredJson } from "../services/ai/OpenAICompatibleClient.mjs";
import { AgentToolRegistry } from "../services/agent/AgentToolRegistry.mjs";
import { AgentOrchestrator } from "../services/agent/AgentOrchestrator.mjs";
import { JobStore } from "../services/JobStore.mjs";
import { createAgentProvider } from "../services/agent/providers/createAgentProvider.mjs";
import { ZaiAgentProvider } from "../services/agent/providers/ZaiAgentProvider.mjs";
import { analyzeProject } from "../services/analysis/ContentAnalysisService.mjs";
import { replaceProjectFile } from "../lib/project-files.mjs";

const sourceId = "11111111-1111-4111-8111-111111111111";
const executionId = "22222222-2222-4222-8222-222222222222";
const transcript = { segments: [
  "La expedición encontró una carretera cerrada. Explicaron cómo regresar sin perderse.",
  "La receta necesitaba menos harina. Al cambiar la temperatura, el pan quedó perfecto.",
  "El equipo decidió defender el puente. Su estrategia funcionó y ganaron la partida.",
  "Aprendimos a calcular el presupuesto familiar. Separar el ahorro evitó nuevas deudas.",
  "La entrevista explica el origen de una canción. Su autor recordó un viaje inolvidable.",
  "La reparación del motor resultó sencilla. Un cable suelto provocaba el problema.",
  "El partido se resolvió en los últimos segundos. La defensa recuperó la pelota.",
  "La investigación comparó dos fuentes. Los documentos permitieron corregir el titular.",
].map((text, i) => ({ id: `s${i}`, startTime: i * 20, endTime: i * 20 + 19.5, text })) };
const json = value => ({ ok: true, status: 200, json: async () => value });
const response = selections => json({ choices: [{ message: { content: JSON.stringify({ selections }) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } });
const readInput = init => { const content=JSON.parse(init.body).messages[1].content; return JSON.parse(typeof content === "string" ? content : content[0].text); };
const selection = candidate => ({ candidateId: candidate.candidateId, title: "Un momento con conclusión", hook: "Una decisión cambia el resultado", reason: "La idea se entiende y llega a una conclusión; requiere revisión humana.", relevanceScore: 80, qualityFlags: [] });
const options = { minDuration: 15, maxDuration: 25, targetDuration: 20, maxCandidates: 3, requireCompleteSentences: true, contentProfile: "ENTERTAINMENT" };
const base = { apiKey: "editor-test-key", model: "fixture-model", baseUrl: "https://example.invalid/v1", apiStyle: "chat-completions", strictSelection: true, usageService: { record: async () => {} } };

test("Z.ai editor reuses only Z.ai credentials, pins the selected model and preserves manual mode", () => {
  const provider = createContentAnalysisProvider({ env: { CLIPFORGE_ANALYSIS_PROVIDER: "zai", ZAI_API_KEY: "zai-key", CLIPFORGE_AI_API_KEY: "unrelated", CLIPFORGE_EDITOR_VISION: "true" } });
  assert.equal(provider.apiKey, "zai-key");
  assert.equal(provider.model, "glm-4.6v-flash");
  assert.equal(provider.baseUrl, "https://api.z.ai/api/paas/v4");
  assert.equal(provider.visionEnabled, true);
  assert.equal(createContentAnalysisProvider({ env: {} }).name, "transcript-heuristic-v2");
  assert.ok(createAgentProvider({ env: { CLIPFORGE_AGENT_PROVIDER: "zai" } }) instanceof ZaiAgentProvider);
});

test("editor uses measured evidence and context, then real candidate IDs with bounded frame references", async () => {
  const inputs = [], usage = [];
  const provider = new OpenAIContentProvider({ ...base, visionEnabled: true, usageService: { record: async value => usage.push(value) },
    frameSampler: async (_project, candidates) => candidates.map(c => ({ candidateId: c.id, time: c.startTime + 2, dataUrl: "data:image/jpeg;base64,/9j/2Q==" })),
    fetchImpl: async (_url, init) => { const input=readInput(init); inputs.push(input); return response(input.candidates.slice(0, 3).map(c => ({ ...selection(c), startTime: 999999 }))); },
  });
  const result = await provider.analyze({ project: { id: sourceId, source: { relativePath: "fixture.mp4" } }, transcript, options,
    audioEnergyWindows: [{ start: 0, end: 200, score: 72 }], sceneChanges: [10, 22, 45] });
  assert.equal(inputs.length, 2);
  assert.equal(inputs[0].contentProfile, "ENTERTAINMENT");
  assert.equal(inputs[0].candidates[0].scoreComponents.audioEnergy, 72);
  assert.ok(inputs[0].candidates.some(c => c.contextAfter || c.contextBefore));
  assert.equal(inputs[1].evidence.video, "SPARSE_STILL_FRAMES");
  assert.ok(inputs[1].visualFrames.length > 0);
  assert.ok(result.every(c => c.startTime < 160 && c.aiAssessment.visualFrameTimes.length === 1));
  assert.ok(result.every(c => c.aiAssessment.reviewRequired && c.aiAssessment.missingEvidence.includes("CONTINUOUS_MOTION")));
  assert.doesNotMatch(JSON.stringify(result), /data:image/);
  assert.deepEqual(usage.map(u => u.operation), ["content-analysis", "content-analysis-visual"]);
});

test("invented IDs, empty rankings and misleading cuts cannot masquerade as successful AI selection", async () => {
  for (const mode of ["invented", "empty", "context"]) {
    const provider=new OpenAIContentProvider({ ...base, fetchImpl: async (_url,init) => {
      const candidate=readInput(init).candidates[0];
      return response(mode === "empty" ? [] : [{ ...selection(candidate), ...(mode === "invented" ? { candidateId: "fake-id" } : { qualityFlags: ["NEEDS_CONTEXT"] }) }]);
    } });
    await assert.rejects(() => provider.analyze({ transcript, options }), error => error.code === "AI_SELECTION_INVALID");
  }
});

test("real chat aggregates reach the editor without claiming access when evidence is absent", async () => {
  const inputs = [];
  const provider = new OpenAIContentProvider({ ...base, fetchImpl: async (_url, init) => {
    const input = readInput(init); inputs.push(input); return response(input.candidates.slice(0, 2).map(selection));
  } });
  const result = await provider.analyze({ transcript, options, chatActivityWindows: [{ start: 0, end: 200,
    score: 90, messages: 80, utc: '2026-10-25T17:00:00Z', baselineMessages: 20, ratio: 4,
    clockUncertaintySeconds: 10, method: 'OBSERVED_CHAT_ROLLING_MEDIAN', limitations: ['REACTION_DELAY_UNKNOWN'] }] });
  assert.equal(inputs[0].evidence.chat, 'OBSERVED_AGGREGATE_WITH_TIMING_UNCERTAINTY');
  assert.equal(inputs[0].candidates[0].chatEvidence.peakMessages, 80);
  assert.ok(result.every(c => !c.aiAssessment.missingEvidence.includes('CHAT')));
  await provider.analyze({ transcript, options });
  assert.equal(inputs[1].evidence.chat, 'NOT_PROVIDED');
});

test("text-only mode reports missing visual evidence and never silently invokes a second model", async () => {
  let calls=0;
  const provider=new OpenAIContentProvider({ ...base, frameSampler: () => assert.fail("not enabled"), fetchImpl: async (_url,init) => { calls++;return response(readInput(init).candidates.slice(0,2).map(selection)); } });
  const result=await provider.analyze({ transcript, options });
  assert.equal(calls,1);
  assert.ok(result.every(c => c.aiAssessment.missingEvidence.includes("VIDEO_FRAMES")));
});

test("editor failures redact the key and retain bounded retry classification", async () => {
  const provider=new OpenAIContentProvider({ ...base, fetchImpl: async () => ({ ok:false,status:429,json:async()=>({ error:{ message:"Rejected editor-test-key" } }) }) });
  await assert.rejects(() => provider.analyze({ transcript,options }), error => {
    assert.doesNotMatch(error.message,/editor-test-key/);assert.equal(error.retryable,true);return true;
  });
});

test("structured visual requests reject remote URLs and too many frames before calling the API", async () => {
  const config={ apiKey:"fixture",model:"fixture",apiStyle:"chat-completions" };
  for(const images of [[{dataUrl:"https://private.invalid/image.jpg"}],Array(25).fill({dataUrl:"data:image/jpeg;base64,/9j/2Q=="})]) {
    await assert.rejects(() => requestStructuredJson({ config, input:{},images,fetchImpl:()=>assert.fail("must not fetch") }), /image limits/);
  }
});

async function isolated(fn) {
  const directory=await mkdtemp(path.join(os.tmpdir(),"clipforge-editor-tools-"));
  const previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=directory;
  try { await fn(); } finally { if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(directory,{recursive:true,force:true}); }
}
const ownerTask = rightsConfirmed => ({ projectId:sourceId,context:{clipping:{count:5,duration:30,rightsConfirmed,contentProfile:"ENTERTAINMENT"}} });

test("clip tools bind immutable owner settings to an idempotent existing-project job", async () => isolated(async () => {
  const loaded=[];
  const tools=new AgentToolRegistry({ loadClipProject:async id=>{loaded.push(id);return {source:{relativePath:"owned.mp4"}};} });
  const context={executionId,task:ownerTask(true)};
  const first=await tools.execute("clips.prepare",{projectId:"attacker",count:100,rightsConfirmed:false},context);
  const second=await tools.execute("clips.prepare",{},context);
  assert.equal(first.jobId,second.jobId);assert.equal(first.status,"QUEUED");
  const job=await new JobStore().get(first.jobId);
  assert.equal(job.payload.projectId,sourceId);assert.equal(job.payload.count,5);assert.equal(job.payload.targetDuration,30);
  assert.equal(job.payload.analysisProvider,"zai");assert.deepEqual(loaded,[sourceId,sourceId]);
}));

test("the model cannot supply its own source permission or change the approved duration", async () => {
  const tools=new AgentToolRegistry({loadClipProject:()=>assert.fail("must wait before loading source")});
  await assert.rejects(() => tools.execute("clips.prepare",{rightsConfirmed:true},{executionId,task:ownerTask(false)}),error=>error.waitingInformation===true);
  const task=ownerTask(true);task.context.clipping.duration=999;
  await assert.rejects(() => tools.execute("clips.prepare",{}, {executionId,task}),/duración/);
});

test("orchestrator grounds completion in a queued job and pauses on missing source information", async () => isolated(async () => {
  const tools=new AgentToolRegistry({loadClipProject:async()=>({source:{relativePath:"owned.mp4"}})});
  let calls=0;
  const provider={decide:async()=>calls++===0?{type:"TOOL",tool:"clips.prepare",input:{}}:{type:"COMPLETE",output:{status:"PUBLISHED",fakeUrl:"https://fake.invalid"}}};
  const agent=new AgentOrchestrator({provider,tools});
  const task=await agent.createTask({objective:"Prepare clips",autonomyMode:"SEMI_AUTO",...ownerTask(true)});
  const completed=await agent.run(task.id);
  assert.equal(completed.status,"COMPLETED");
  const output=completed.history.find(e=>e.type==="execution_completed")?.details?.output;
  const event=completed.history.find(e=>e.type==="execution_completed");
  assert.ok(event);assert.doesNotMatch(JSON.stringify(event),/PUBLISHED|fake.invalid/);
  assert.ok(output?.jobId || JSON.stringify(event).includes("bestclips-"));
  const missing=new AgentOrchestrator({tools,provider:{decide:async()=>({type:"TOOL",tool:"clips.prepare",input:{rightsConfirmed:true}})}});
  const waiting=await missing.createTask({objective:"Prepare clips",autonomyMode:"SEMI_AUTO",...ownerTask(false)});
  assert.equal((await missing.run(waiting.id)).status,"WAITING_INFORMATION");
}));

test("completion without a real clipping tool result pauses instead of reporting fake success", async () => isolated(async () => {
  const agent=new AgentOrchestrator({tools:new AgentToolRegistry(),provider:{decide:async()=>({type:"COMPLETE",output:{clips:"fake"}})}});
  const task=await agent.createTask({objective:"Prepare clips",autonomyMode:"SEMI_AUTO",...ownerTask(true)});
  assert.equal((await agent.run(task.id)).status,"WAITING_INFORMATION");
}));

test("changing the model invalidates analysis cache while identical settings reuse it", async () => isolated(async () => {
  await replaceProjectFile(sourceId,{id:sourceId,source:{durationSeconds:160},transcript:{...transcript,id:'fixture-transcript',status:'COMPLETED',completedAt:'2026-10-24T12:00:00Z'}});
  let calls=0;
  const provider={name:'fixture-editor',model:'first',analyze:async()=>{calls++;return [{id:'candidate-1'}];}};
  assert.equal((await analyzeProject(sourceId,{provider})).reused,false);
  assert.equal((await analyzeProject(sourceId,{provider})).reused,true);
  provider.model='second';
  assert.equal((await analyzeProject(sourceId,{provider})).reused,false);assert.equal(calls,2);
}));

test("cancelling during model inference prevents the subsequent clipping tool", async () => isolated(async () => {
  let release,started;
  const gate=new Promise(resolve=>{release=resolve;});const entered=new Promise(resolve=>{started=resolve;});
  let toolsCalled=0;
  const agent=new AgentOrchestrator({provider:{decide:async()=>{started();await gate;return {type:'TOOL',tool:'clips.prepare',input:{}};}},tools:{listDefinitions:()=>[],execute:async()=>{toolsCalled++;return {};}}});
  const task=await agent.createTask({objective:'Prepare clips',autonomyMode:'SEMI_AUTO',...ownerTask(true)});
  const running=agent.run(task.id);await entered;await agent.cancel(task.id,'Owner cancelled');release();
  assert.equal((await running).status,'CANCELLED');assert.equal(toolsCalled,0);
}));
