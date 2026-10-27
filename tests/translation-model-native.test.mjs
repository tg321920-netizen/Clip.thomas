import test from 'node:test';import assert from 'node:assert/strict';
import path from 'node:path';import os from 'node:os';
import {mkdtemp,readFile,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {LocalTranslationProvider} from '../services/subtitles/LocalTranslationProvider.mjs';
const model=process.env.CLIPFORGE_NATIVE_MARIAN_MODEL;
test('native Marian assets are verified and a damaged tokenizer cannot produce accepted subtitles',
  {skip:!model?'Explicit optional local Marian model not configured':false},async t=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'cf-marian-integrity-'));t.after(()=>rm(root,{recursive:true,force:true}));
    const metadata=JSON.parse(await readFile(path.join(model,'metadata.json'),'utf8'));
    await writeFile(path.join(root,'metadata.json'),JSON.stringify(metadata));
    for(const name of Object.keys(metadata.files)){
      await mkdir(path.dirname(path.join(root,name)),{recursive:true});
      if(name==='source.spm')await writeFile(path.join(root,name),'intentionally damaged isolated QA asset');
      else await symlink(path.join(model,name),path.join(root,name));
    }
    const provider=new LocalTranslationProvider({env:{...process.env,CLIPFORGE_TRANSLATION_MODEL_PATH:root}});
    await assert.rejects(provider.translateRaw(['Confidential source text must not appear in an error.']),error=>{
      assert.equal(error.code,'TRANSLATION_FAILED');assert.doesNotMatch(error.message,/Confidential|cf-marian|source.spm/);return true;
    });
  });
