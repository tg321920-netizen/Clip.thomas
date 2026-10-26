import test from "node:test";
import assert from "node:assert/strict";
import { decodeStructuredText } from "../services/ai/OpenAICompatibleClient.mjs";
const object={selections:[{candidateId:"allowed",reason:'Una llave { dentro de "texto" } no cambia la estructura.'}]};
test("JSON wrapper recovery preserves exactly the original data and never invents fields",()=>{
  for(const text of [JSON.stringify(object),`\u0060\u0060\u0060json\n${JSON.stringify(object)}\n\u0060\u0060\u0060`,`Resultado:\n${JSON.stringify(object)}\nFin.`,`<think>Reasoning omitted.</think>\n${JSON.stringify(object)}`])assert.deepEqual(decodeStructuredText(text).parsed,object);
});
test("ambiguous, truncated and semantically repaired JSON remains invalid",()=>{
  for(const text of ['{"selections":[]} {"selections":[]}','{"selections":[','{"selections":[],}','{selections:[]}', '[ {"selections":[]} ] trailing'])assert.throws(()=>decodeStructuredText(text));
});
