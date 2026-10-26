import test from 'node:test';
import assert from 'node:assert/strict';
import {TranscriptCandidateProvider} from '../services/analysis/TranscriptCandidateProvider.mjs';
import {isAnalysisCurrent} from '../services/analysis/ContentAnalysisService.mjs';
import {sentenceSegments} from '../services/analysis/AudioEnergyService.mjs';
test('old heuristic cache cannot hide the repaired duration and context algorithm',()=>{
  const project={transcript:{id:'t',completedAt:'now',model:'real',segments:[{}]},analysis:{provider:'transcript-heuristic-v2',status:'COMPLETED',sourceKey:'t:now:real:1',candidates:[{}]}};
  assert.equal(isAnalysisCurrent(project),false);
  project.analysis.provider='transcript-heuristic-v3';assert.equal(isAnalysisCurrent(project),false);
  project.analysis.provider='transcript-heuristic-v4';assert.equal(isAnalysisCurrent(project),true);
});
test('applause does not move a complete speech boundary into non-spoken audio',async()=>{
  const segments=sentenceSegments([{startTime:0,endTime:4,text:'An earlier statement.'},{startTime:4,endTime:6,text:'[APPLAUSE]'},{startTime:6,endTime:32,text:'We choose to do this work because the challenge deserves our best efforts.'}]);
  const candidates=await new TranscriptCandidateProvider().analyze({transcript:{segments},options:{minDuration:20,maxDuration:30,targetDuration:26,requireCompleteSentences:true}});
  assert.ok(candidates.some(c=>c.startTime===6&&c.endTime===32));
  assert.ok(candidates.every(c=>!c.text.includes('APPLAUSE')));
});
test('a sparse transcript never bypasses requested clip duration through fallback',async()=>{
  const result=await new TranscriptCandidateProvider().analyze({
    transcript:{segments:[{startTime:0,endTime:1,text:'¿Por qué?'},{startTime:300,endTime:301,text:'Esta es la respuesta.'}]},
    options:{minDuration:15,maxDuration:45,targetDuration:30}});
  assert.deepEqual(result,[]);
});
test('podcasts keep a question with following speech, use supplied speaker labels and do not require chat',async()=>{
  const provider=new TranscriptCandidateProvider();
  const segments=[
    {startTime:0,endTime:6,text:'¿Cómo aprendiste a entrevistar y escuchar de verdad a una persona?',speaker:'HOST'},
    {startTime:6,endTime:22,text:'Primero escuché con atención cada historia. Después comprendí que preguntar bien requiere tiempo, paciencia y preparación.',speaker:'GUEST'},
    {startTime:22,endTime:30,text:'Sin embargo, equivocarse también ayuda a encontrar una respuesta completa y útil.',speaker:'GUEST'},
    {startTime:30,endTime:42,text:'Finalmente decidimos practicar cada día y mejoramos la forma de contar nuestras historias.',speaker:'HOST'},
  ];
  const result=await provider.analyze({transcript:{segments},options:{minDuration:15,maxDuration:45,targetDuration:30,contentProfile:'PODCAST'}});
  assert.ok(result.length>0);
  assert.equal(result.some(c=>c.startTime===6),false);
  const question=result.find(c=>c.startTime===0);assert.ok(question);
  assert.equal(question.dialogueEvidence.questionWithFollowingSpeech,true);
  assert.equal(question.dialogueEvidence.speakerBasis,'PROVIDED_TRANSCRIPT_LABELS');
  assert.ok(question.dialogueEvidence.speakerChanges>0);
  assert.equal(question.components.chatActivity,null);
  assert.equal(question.dialogueEvidence.emotionRecognition,'NOT_PERFORMED');
  assert.equal(question.missingSignals.includes('speakerChanges'),false);
});
test('missing speaker labels remain unknown, and windows never cross a long untranscribed silence',async()=>{
  const segments=[
    {startTime:0,endTime:10,text:'Una historia completa empieza con una pregunta interesante.'},
    {startTime:10,endTime:26,text:'La respuesta explica por qué debemos escuchar y aprender con paciencia.'},
    {startTime:90,endTime:110,text:'Otro tema diferente empieza después de un silencio largo y termina aquí.'},
  ];
  const result=await new TranscriptCandidateProvider().analyze({transcript:{segments},options:{minDuration:15,maxDuration:120,maxCandidates:10}});
  assert.ok(result.length>0);
  for(const c of result){assert.ok(!(c.startTime<90&&c.endTime>26));assert.equal(c.dialogueEvidence.speakerChanges,null);assert.ok(c.missingSignals.includes('speakerChanges'));}
});
