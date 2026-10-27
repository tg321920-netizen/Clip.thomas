// Optional real, offline inference. No synthetic media, model downloads, paid
// calls, original project changes or R2 writes. Public-domain NASA regressions.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { LocalTranslationProvider } from '../services/subtitles/LocalTranslationProvider.mjs';
import { assessTranslation, TRANSLATION_PIPELINE_VERSION } from '../services/subtitles/TranslationQualityService.mjs';

const provider = new LocalTranslationProvider();provider.assertConfigured();
const glossary = [{ source: 'Rice', target: 'Rice' }, { source: 'Texas', target: 'Texas' }, { source: 'Saturn C-1', target: 'Saturno C-1' }];
const cases = [
  { source: 'Why does rice play Texas?', before: 'Why climb the highest mountain?', after: 'We choose to go to the moon.' },
  { source: 'And its opportunity for peaceful cooperation may never come again.', before: 'Its conquest deserves the best of all mankind.', after: 'But why, some say, the moon?' },
  { source: 'We have felt the ground shake and the air shattered by the testing of a Saturn C-1 booster rocket.', before: 'In the last 24 hours we have seen facilities for exploration.', after: 'Its power is equivalent to 10,000 automobiles.' },
  { source: 'We did not spend 15 million dollars in Texas. Did NASA approve it?', before: '', after: '' },
];
const started=Date.now();
const baseline=await provider.translateRaw(cases.map(item=>item.source));
const result=await provider.translate(cases.map(item=>item.source),{ contexts: cases.map(item=>({ before:item.before,after:item.after })),glossary });
const items=cases.map((item,index)=>({ ...item, beforeRepair: baseline.texts[index], afterRepair: result.texts[index],
  contextUsed: result.units[index].contextUsed, quality: assessTranslation(item.source,result.texts[index],{glossary,issues:result.units[index].issues}) }));
assert.match(items[0].afterRepair,/\bRice\b/u);assert.doesNotMatch(items[0].afterRepair,/\barroz\b/iu);
assert.match(items[3].afterRepair,/\b15\b/u);assert.match(items[3].afterRepair,/\bNASA\b/u);assert.match(items[3].afterRepair,/\bno\b/iu);
assert.ok(items[2].quality.issues.includes('AMBIGUOUS_EVENT_EXPRESSION'));
const evidence={ checkedAt:new Date().toISOString(), realModel:true, externalAiCalls:0, source:'NASA/JFK source transcript regressions',
  modelSha256: result.modelSha256, pipelineVersion:TRANSLATION_PIPELINE_VERSION, elapsedSeconds:(Date.now()-started)/1000,
  semanticQuality:'PARTIAL_REQUIRES_EDITORIAL_REVIEW', protectedTermChecksPassed:true, universalSemanticAccuracyClaimed:false, items };
await mkdir('artifacts/completion-20261027',{recursive:true});
await writeFile('artifacts/completion-20261027/translation-real-evaluation.json',JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
