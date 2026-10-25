import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:393,height:851},isMobile:true,hasTouch:true});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  let configured=false,created=null;const executions=[];
  await page.route('**/api/projects',route=>route.fulfill({json:{projects:[{id:'11111111-1111-4111-8111-111111111111',source:{originalName:'Video propio de prueba'}},{id:'22222222-2222-4222-8222-222222222222',source:{originalName:'Otro video propio'}}]}}));
  await page.route('**/api/agent/executions',async route=>{
    if(route.request().method()==='POST'){
      created=route.request().postDataJSON();
      const execution={id:'fixture-execution',status:'COMPLETED',task:{objective:created.objective,autonomyMode:'SEMI_AUTO'},stepCount:1,updatedAt:new Date().toISOString()};
      executions.push(execution);return route.fulfill({status:201,json:{execution}});
    }
    return route.fulfill({json:{enabled:false,mode:'SEMI_AUTO',providerConfigured:configured,editorConfigured:configured,provider:'zai',model:'glm-4.6v-flash',editorModel:'glm-4.6v-flash',editorVision:true,executions}});
  });
  await page.goto(`${process.env.CLIPFORGE_TEST_BASE_URL||'http://127.0.0.1:3135'}/autopilot`,{waitUntil:'networkidle'});
  const form=page.getByRole('group',{name:'Preparar clips con el agente'});
  await form.getByText('Falta configurar la clave de API del servidor. El análisis manual sigue disponible.').waitFor();
  const button=form.getByRole('button',{name:'Preparar 5 clips con IA',exact:true});assert.equal(await button.isDisabled(),true);
  configured=true;await page.getByRole('button',{name:'Actualizar',exact:true}).click();
  await form.getByLabel('Video original para el agente').selectOption('11111111-1111-4111-8111-111111111111');
  const rights=form.getByRole('checkbox');assert.equal(await rights.isChecked(),false);await rights.check();
  assert.equal(await button.isEnabled(),true);await button.click();
  await form.getByText('Trabajo encolado. El progreso y los MP4 aparecerán en Mis videos cuando termine el procesamiento.').waitFor();
  assert.equal(created.context.clipping.count,5);assert.equal(created.context.clipping.duration,30);assert.equal(created.context.clipping.rightsConfirmed,true);assert.equal(created.autonomyMode,'SEMI_AUTO');
  await form.getByLabel('Video original para el agente').selectOption('22222222-2222-4222-8222-222222222222');
  assert.equal(await rights.isChecked(),false);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);assert.deepEqual(errors,[]);
  await mkdir('artifacts/mobile-agent',{recursive:true});await page.screenshot({path:'artifacts/mobile-agent/screen.png',fullPage:true});
  await writeFile('artifacts/mobile-agent/evidence.json',JSON.stringify({passed:true,viewport:'393x851',checks:['missing API is explicit','5 clips / 30 seconds defaults','owner rights required and reset on source change','queued job is distinct from MP4 ready','no overflow or JS errors'],scope:'Chromium with explicit local API fixtures; no live model quality claim'},null,2));
  console.log('Mobile agent UI passed.');
} finally {await browser.close();}
