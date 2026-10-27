// Explicit real local inference only. No model downloads, paid APIs, encodes,
// original project edits, R2 writes or claims of universal semantic accuracy.
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir,writeFile } from 'node:fs/promises';
import { LocalTranslationProvider } from '../services/subtitles/LocalTranslationProvider.mjs';
import { assessTranslation } from '../services/subtitles/TranslationQualityService.mjs';
const option = name => process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const candidateModel=option('candidate-model'),baselineModel=option('baseline-model');
if(!candidateModel||!baselineModel||!process.env.CLIPFORGE_TRANSLATION_PYTHON)throw new Error('Provide explicit local candidate/baseline models and translation Python.');
const cases=[
  {source:'Why does Rice play Texas?',before:'Why climb the highest mountain?',after:'We choose to go to the moon.'},
  {source:'And its opportunity for peaceful cooperation may never come again.',before:'Its conquest deserves the best of all mankind.',after:'But why, some say, the moon?'},
  {source:'We have felt the ground shake and the air shattered by the testing of a Saturn C-1 booster rocket.',before:'In the last 24 hours we have seen facilities for exploration.',after:'Its power is equivalent to 10,000 automobiles.'},
  {source:'We did not spend 15 million dollars in Texas. Did NASA approve it?'},
];
const glossary=[{source:'Rice',target:'Rice'},{source:'Texas',target:'Texas'},{source:'Saturn C-1',target:'Saturno C-1'}];
const inputs=cases.map(value=>value.source),contexts=cases.map(({before,after})=>({before,after}));
const started=Date.now(),output={checkedAt:new Date().toISOString(),realLocalModel:true,externalApiCalls:0,modelDownloads:0,
  source:'NASA/JFK TRANSCRIPT TEXT REGRESSIONS (fourth case is an explicit language fixture)',
  semanticStatus:'REVIEW_REQUIRED',semanticCertification:false};
for(const [name,model] of [['baseline',baselineModel],['candidate',candidateModel]]){
  const provider=new LocalTranslationProvider({env:{...process.env,CLIPFORGE_TRANSLATION_MODEL_PATH:path.resolve(model)}});
  const direct=await provider.translateRaw(inputs),translated=await provider.translate(inputs,{contexts,glossary});
  output[name]={modelSha256:translated.modelSha256,modelId:translated.modelId,modelRevision:translated.modelRevision,
    modelFormat:translated.modelFormat,modelLicense:translated.modelLicense,
    items:cases.map((value,index)=>({...value,direct:direct.texts[index],translated:translated.texts[index],
      contextUsed:translated.units[index].contextUsed,
      quality:assessTranslation(value.source,translated.texts[index],{glossary,issues:translated.units[index].issues})}))};
}
assert.equal(output.candidate.modelFormat,'marian-ct2-v1');
assert.equal(output.candidate.modelRevision,'8f4d4924189681076e9c642b2fd85278d793fd4d');
assert.match(output.candidate.items[0].translated,/\bRice\b/u);assert.doesNotMatch(output.candidate.items[0].translated,/\barroz\b/iu);
assert.match(output.candidate.items[1].translated,/nunca|jamás/iu);assert.doesNotMatch(output.candidate.items[1].translated,/volver a empezar/iu);
assert.match(output.candidate.items[2].translated,/tembl|sacud/iu);assert.doesNotMatch(output.candidate.items[2].translated,/batido/iu);
assert.match(output.candidate.items[3].translated,/\b15\b/u);assert.match(output.candidate.items[3].translated,/\bNASA\b/u);assert.match(output.candidate.items[3].translated,/\bNo\b/iu);
assert.ok(output.candidate.items.every(item=>item.quality.status==='REVIEW_REQUIRED'));
output.elapsedSeconds=(Date.now()-started)/1000;output.passed=true;
await mkdir('artifacts/master-mission-20261028',{recursive:true});
await writeFile('artifacts/master-mission-20261028/translation-model-comparison.json',JSON.stringify(output,null,2));
console.log(JSON.stringify(output));
