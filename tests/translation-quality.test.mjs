import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import { normalizeGlossary, prepareTranslationInput, recoverTranslation, assessTranslation, subtitleReadability } from '../services/subtitles/TranslationQualityService.mjs';
import { updateSubtitleTrack, restoreSubtitleVersion, buildAssDocument } from '../services/subtitles/SubtitleService.mjs';
import { replaceProjectFile, loadProjectFile } from '../lib/project-files.mjs';

test('glossaries protect complete terms, acronyms and numbers without replacing inside other words',()=>{
  const item=prepareTranslationInput('Why does rice play Texas in 1962? NASA approved it.',{},[{source:'Rice',target:'Rice'},{source:'Texas',target:'Texas'}]);
  assert.doesNotMatch(item.direct,/rice|Texas|1962|NASA/iu);
  const text=item.direct.replace('Why does','Por qué').replace('play','juega');
  const recovered=recoverTranslation(item,text);
  assert.match(recovered.text,/Rice juega Texas/);assert.match(recovered.text,/1962/);assert.match(recovered.text,/NASA/);
  const other=prepareTranslationInput('Priceless stories.',{},[{source:'rice',target:'arroz'}]);
  assert.equal(other.direct,'Priceless stories.');
  assert.throws(()=>normalizeGlossary([{source:'NASA',target:'NASA'},{source:'nasa',target:'NASA'}]),/repetidos/);
});

test('context is accepted only between two unique intact boundaries, otherwise the measured direct result is kept',()=>{
  const item=prepareTranslationInput('It may never come again.',{before:'Peaceful cooperation is possible.',after:'Why the moon?'});
  const good=recoverTranslation(item,'Puede nunca volver a empezar.',`Antes. ${item.begin} Puede que nunca vuelva a presentarse. ${item.end} Después.`);
  assert.equal(good.text,'Puede que nunca vuelva a presentarse.');assert.equal(good.contextUsed,true);
  const bad=recoverTranslation(item,'Puede nunca volver a empezar.','Invalid context with no boundaries');
  assert.equal(bad.contextUsed,false);assert.equal(bad.text,'Puede nunca volver a empezar.');assert.ok(bad.issues.includes('CONTEXT_ALIGNMENT_UNAVAILABLE'));
  assert.throws(()=>recoverTranslation(item,'ZXQ123ZXQ'),{code:'TRANSLATION_ALIGNMENT_INVALID'});
});

test('NASA risks flag negation, figures, omissions, modality and ambiguous event expressions without fixed phrase replacement',()=>{
  assert.ok(assessTranslation('We did not spend 15 million dollars.','Gastamos 50 millones de dólares.').issues.includes('NEGATION_REVIEW'));
  assert.ok(assessTranslation('We did not spend 15 million dollars.','Gastamos 50 millones de dólares.').issues.includes('NUMBER_REVIEW'));
  assert.ok(assessTranslation('Its opportunity may never come again.','Su oportunidad no puede volver.').issues.includes('MODALITY_REVIEW'));
  assert.ok(assessTranslation('We have felt the ground shake.','Hemos sentido el batido de tierra.').issues.includes('AMBIGUOUS_EVENT_EXPRESSION'));
  assert.ok(assessTranslation('Why does rice play Texas?','¿Por qué el arroz juega Texas?',{glossary:[{source:'Rice',target:'Rice'}]}).issues.includes('GLOSSARY_REVIEW'));
  assert.equal(assessTranslation('It works.','Funciona.').status,'REVIEW_REQUIRED');
  assert.equal(assessTranslation('We did not spend fifteen million dollars.','No gastamos 15 millones de dólares.').issues.includes('NUMBER_REVIEW'),false);
  assert.equal(assessTranslation('There is no conflict.','No hay conflicto.').issues.includes('NEGATION_REVIEW'),false);
  assert.ok(assessTranslation('It may never come again.','Puede volver a empezar.').issues.includes('IDIOM_OR_PHRASAL_VERB_REVIEW'));
});

test('context cannot override a safer direct translation with a measured change of number or modality',()=>{
  const modal=prepareTranslationInput('It may never come again.',{before:'Peace is possible.'});
  const result=recoverTranslation(modal,'Puede que nunca vuelva a ocurrir.',`${modal.begin} Nunca puede volver. ${modal.end}`);
  assert.equal(result.text,'Puede que nunca vuelva a ocurrir.');assert.equal(result.contextUsed,false);
  assert.ok(result.issues.includes('CONTEXT_SEMANTIC_RISK_FALLBACK'));
  const numeric=prepareTranslationInput('We spent fifteen million dollars.',{before:'The budget changed.'});
  assert.equal(recoverTranslation(numeric,'Gastamos quince millones de dólares.',`${numeric.begin} Gastamos cincuenta millones de dólares. ${numeric.end}`).text,'Gastamos quince millones de dólares.');
});

test('subtitle readability and horizontal placement use the actual output size',()=>{
  assert.equal(subtitleReadability([{id:'short',text:'Too much text for a fraction of a second.',startTime:0,endTime:.2}])[0].issues.includes('READING_SPEED_HIGH'),true);
  const ass=buildAssDocument({style:'CLEAN',layout:{fontSize:60,position:'TOP',marginPercent:10,color:'#FF2200'},cues:[]},{width:1280,height:720});
  assert.match(ass,/PlayResX: 1280/);assert.match(ass,/PlayResY: 720/);assert.match(ass,/Arial,23,&H000022FF/);assert.match(ass,/,8,95,95,72,1/);
});

test('each correction is recoverable, stale tabs cannot overwrite it, restoring preserves the newer version and interval',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'cf-history-'));const previous=process.env.CLIPFORGE_STORAGE_DIR;process.env.CLIPFORGE_STORAGE_DIR=root;
  t.after(async()=>{if(previous===undefined)delete process.env.CLIPFORGE_STORAGE_DIR;else process.env.CLIPFORGE_STORAGE_DIR=previous;await rm(root,{recursive:true,force:true});});
  const id='367dc82f-75a7-48ce-9292-e53c680795b7',clipId='cce35629-59cd-4ff4-99d9-78a4996bc839';
  const track={style:'CLEAN',enabled:true,updatedAt:'first',cues:[{id:'cue-1',startTime:0,endTime:2,text:'First translation.'}]};
  await replaceProjectFile(id,{id,clips:[{id:clipId,status:'DRAFT',startTime:20,endTime:30,duration:10,subtitles:track,edit:{}}]});
  await updateSubtitleTrack(id,clipId,{expectedUpdatedAt:'first',cues:[{...track.cues[0],text:'Corrección uno.'}]});
  await assert.rejects(updateSubtitleTrack(id,clipId,{expectedUpdatedAt:'first',cues:track.cues}),{code:'SUBTITLE_STALE'});
  let clip=(await loadProjectFile(id)).clips[0];assert.equal(clip.subtitleHistory[0].track.cues[0].text,'First translation.');
  await updateSubtitleTrack(id,clipId,{cues:[{...track.cues[0],text:'Corrección dos.'}]});
  await restoreSubtitleVersion(id,clipId,clip.subtitleHistory[0].versionId);
  clip=(await loadProjectFile(id)).clips[0];assert.equal(clip.subtitles.cues[0].text,'First translation.');
  assert.equal(clip.subtitleHistory.length,3);assert.equal(clip.subtitleHistory[2].track.cues[0].text,'Corrección dos.');
  assert.equal(clip.startTime,20);assert.equal(clip.endTime,30);
});
