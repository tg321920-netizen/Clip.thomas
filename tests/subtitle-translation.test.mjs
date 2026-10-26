import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSubtitleTrack, buildSrtDocument} from '../services/subtitles/SubtitleService.mjs';
import {LocalTranslationProvider} from '../services/subtitles/LocalTranslationProvider.mjs';

const project={transcript:{id:'real-or-fixture-asr',status:'COMPLETED',language:'en',segments:[
  {startTime:5,endTime:9,text:'We did not spend 15 million dollars.'},
  {startTime:11,endTime:14,text:'Why did NASA choose this mission?'},
]}};
const clip={startTime:5,endTime:15,duration:10,edit:{subtitleMode:'TRANSLATE_ES',subtitleStyle:'KARAOKE'}};

test('translation adapter is optional and never substitutes original text on failure',async()=>{
  await assert.rejects(new LocalTranslationProvider({env:{}}).translate(['Hello']),{code:'TRANSLATION_NOT_CONFIGURED'});
  const before=structuredClone(project);
  await assert.rejects(prepareSubtitleTrack(project,clip,{translator:{translate:async()=>{throw new Error('Provider unavailable');}}}),/Provider unavailable/);
  assert.deepEqual(project,before);
});

test('simulated translation keeps sentence intervals, provenance and original audio',async()=>{
  let observed;
  const track=await prepareSubtitleTrack(project,clip,{translator:{translate:async texts=>{observed=texts;return{texts:['No gastamos 15 millones de dólares.','¿Por qué la NASA eligió esta misión?'],provider:'MOCK_FOR_UNIT_TEST',modelSha256:'a'.repeat(64)};}}});
  assert.deepEqual(observed,['We did not spend 15 million dollars.','Why did NASA choose this mission?']);
  assert.equal(track.language,'es');assert.equal(track.sourceLanguage,'en');assert.equal(track.reviewStatus,'PENDING');
  assert.equal(track.translation.audioReplaced,false);assert.equal(track.translation.provider,'MOCK_FOR_UNIT_TEST');
  assert.equal(track.cues[0].startTime,0);assert.equal(track.cues[0].endTime,4);assert.equal(track.cues[1].startTime,6);
  assert.ok(track.cues.every(c=>!c.words&&c.endTime<=10));assert.equal(track.sourceCues.filter(c=>c.endTime<=4).map(c=>c.text).join(' '),observed[0]);
  assert.match(buildSrtDocument(track),/No gastamos 15/);assert.match(buildSrtDocument(track),/NASA/);
});

test('a wrong language or invalid translation count is rejected before rendering',async()=>{
  let called=false;const translator={translate:async()=>{called=true;return{texts:[]};}};
  await assert.rejects(prepareSubtitleTrack({...project,transcript:{...project.transcript,language:'es'}},clip,{translator}),/no es inglés/);
  assert.equal(called,false);
  await assert.rejects(prepareSubtitleTrack(project,clip,{translator}),/Cantidad/);
});

test('original English and Spanish captions need no translation provider; NONE needs no ASR',async()=>{
  const translator={translate:async()=>{throw new Error('Must not be called');}};
  const en=await prepareSubtitleTrack(project,{...clip,edit:{subtitleMode:'ORIGINAL_EN'}},{translator});
  assert.equal(en.language,'en');assert.equal(en.translation,undefined);assert.match(en.cues[0].text,/did not/);
  const es=await prepareSubtitleTrack({...project,transcript:{...project.transcript,language:'es'}},{...clip,edit:{subtitleMode:'ORIGINAL_ES'}},{translator});
  assert.equal(es.language,'es');
  assert.equal(await prepareSubtitleTrack({}, {edit:{subtitleMode:'NONE'}},{translator}),null);
});
