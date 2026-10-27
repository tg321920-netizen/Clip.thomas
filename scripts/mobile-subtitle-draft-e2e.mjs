// Real local API + authenticated mobile Chromium. Copies metadata and hardlinks
// an already verified authorized source/clip into an isolated QA root. No model,
// media encode, R2 write, production request or publishing operation is started.
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, readdir, writeFile, link } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { hashFile } from '../services/ingest/ResumableUploadStore.mjs';
import { updateProjectFile } from '../lib/project-files.mjs';
import { stopChildProcesses } from '../lib/child-shutdown.mjs';

const argument = process.argv.find(value => value.startsWith('--source-project='))?.slice(17);
if (!argument || !process.argv.includes('--rights-confirmed')) throw new Error('Use --source-project=PATH for an existing authorized project and --rights-confirmed.');
const sourceFile = path.resolve(argument);
if (!sourceFile.startsWith(path.resolve('artifacts') + path.sep)) throw new Error('Use an existing QA project under artifacts.');
const sourceRoot = path.dirname(path.dirname(sourceFile)), project = JSON.parse(await readFile(sourceFile, 'utf8'));
const clip = project.clips?.find(value => value.candidateId?.startsWith('manual-') && value.status === 'READY' && value.subtitles?.cues?.length && value.render?.relativePath);
assert.ok(clip, 'The cached manual clip must already have a verified caption track.');
const sourceClip = path.resolve(sourceRoot, clip.render.relativePath), clipSha256 = await hashFile(sourceClip);
const parent = path.resolve('artifacts/hardening-20261027'); await mkdir(parent, { recursive: true });
const run = await mkdtemp(path.join(parent, 'mobile-subtitle-')), root = path.join(run, 'storage');
project.clips = [clip];
for (const relative of new Set([project.source.relativePath, clip.render.relativePath])) {
  const original = path.resolve(sourceRoot, relative), destination = path.resolve(root, relative);
  assert.ok(original.startsWith(sourceRoot + path.sep) && destination.startsWith(root + path.sep));
  await mkdir(path.dirname(destination), { recursive: true }); await link(original, destination);
}
await mkdir(path.join(root, 'projects'), { recursive: true });
await writeFile(path.join(root, 'projects', `${project.id}.json`), JSON.stringify(project));
process.env.CLIPFORGE_STORAGE_DIR = root;
const port = Number(process.env.CLIPFORGE_TEST_PORT || 3187), base = `http://127.0.0.1:${port}`, accessKey = randomBytes(32).toString('hex');
const env = { ...process.env, CLIPFORGE_STORAGE_DIR: root, CLIPFORGE_RELEASE_CHANNEL: 'stable', CLIPFORGE_EXPERIMENTAL_FEATURES: 'false',
  CLIPFORGE_REQUIRE_OWNER_AUTH: 'true', CLIPFORGE_OWNER_ACCESS_KEY: accessKey, CLIPFORGE_SESSION_KEY: randomBytes(32).toString('hex'),
  CLIPFORGE_AGENT_ENABLED: 'false', CLIPFORGE_LIVE_MONITOR_ENABLED: 'false', CLIPFORGE_LIVE_CAPTURE_ENABLED: 'false',
  CLIPFORGE_AGENT_REAL_PUBLISHING: 'false', CLIPFORGE_CONTENT_REAL_PUBLISHING: 'false', CLIPFORGE_SMART_PUBLISH_ON_BOOT: 'false',
  CLIPFORGE_MEDIA_STORAGE_PROVIDER: 'local', CLIPFORGE_PROJECT_BACKUP_ENABLED: 'false', CLIPFORGE_REDIS_URL: '', REDIS_URL: '', VERCEL: '', VERCEL_ENV: '' };
const log = await open(path.join(run, 'runtime.log'), 'w');
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', String(port)], { env, stdio: ['ignore', log.fd, log.fd] });
let browser;
const evidence = { checkedAt: new Date().toISOString(), nodeVersion: process.version, apiMocks: false, physicalAndroid: false,
  publicDeployment: false, source: 'CACHED_AUTHORIZED_CAPTIONED_MEDIA', newClips: 0, newEncodes: 0, externalModelCalls: 0, r2Writes: 0, run };
try {
  let ready = false;
  for (let attempt = 0; attempt < 45; attempt++) {
    assert.ok(server.exitCode === null && server.signalCode === null, 'The private QA server exited before readiness.');
    try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {}
    await delay(500);
  }
  assert.ok(ready); assert.equal((await fetch(base + '/api/projects')).status, 401);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.name));
  await page.goto(base); await page.getByLabel('Clave de acceso', { exact: true }).fill(accessKey);
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await page.locator(`article[data-project-id="${project.id}"]`).getByRole('button', { name: 'Abrir proyecto', exact: true }).click();
  const editor = page.getByRole('region', { name: 'Recorte manual' });
  const input = editor.getByLabel(`Texto del subtítulo ${clip.subtitles.cues[0].id}`, { exact: true }); await input.waitFor();
  const originalText = await input.inputValue(), draftText = originalText + ' [borrador de QA sin guardar]';
  await input.fill(draftText);
  async function pollAfter(mutate) {
    const response = page.waitForResponse(value => value.url() === `${base}/api/projects/${project.id}/clips` && value.request().method() === 'GET');
    await updateProjectFile(project.id, mutate); await response; await delay(150);
  }
  await pollAfter(saved => { saved.clips[0].updatedAt = new Date(Date.now() + 1000).toISOString(); });
  assert.equal(await input.inputValue(), draftText, 'Background project refresh discarded the unsaved subtitle draft.');
  evidence.draftSurvivedUnrelatedRefresh = true;
  const otherText = originalText + ' [otra versión guardada en QA]';
  await pollAfter(saved => {
    saved.clips[0].subtitles.cues[0].text = otherText;
    saved.clips[0].subtitles.updatedAt = new Date(Date.now() + 2000).toISOString();
    saved.clips[0].updatedAt = saved.clips[0].subtitles.updatedAt;
  });
  assert.equal(await input.inputValue(), draftText, 'A remote subtitle revision replaced an unsaved edit.');
  await editor.getByText('Hay otra versión guardada. Tus cambios sin guardar se conservan.', { exact: true }).waitFor();
  const conflict = page.waitForResponse(value => value.url().endsWith(`/clips/${clip.id}/subtitles`) && value.request().method() === 'PATCH');
  await editor.getByRole('button', { name: 'Guardar y volver a renderizar', exact: true }).click();
  assert.equal((await conflict).status(), 409);
  assert.equal(await input.inputValue(), draftText);
  evidence.conflictingSaveKeptBothVersions = true;
  await editor.getByRole('button', { name: 'Descartar mis cambios y cargar la versión guardada', exact: true }).click();
  assert.equal(await input.inputValue(), otherText);
  evidence.explicitDiscardLoadsSavedRevision = true;
  const cleanText = originalText + ' [versión de QA actualizada sin cambios locales]';
  await pollAfter(saved => {
    saved.clips[0].subtitles.cues[0].text = cleanText;
    saved.clips[0].subtitles.updatedAt = new Date(Date.now() + 3000).toISOString();
    saved.clips[0].updatedAt = saved.clips[0].subtitles.updatedAt;
  });
  assert.equal(await input.inputValue(), cleanText);
  evidence.cleanEditorFollowsSavedRevision = true;
  assert.deepEqual(errors, []); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  const jobs = await readdir(path.join(root, 'jobs')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  assert.equal(jobs.filter(name => name.endsWith('.json')).length, 0, 'A conflicting save must not enqueue a render.');
  assert.equal(await hashFile(sourceClip), clipSha256); evidence.cachedMediaHashPreserved = clipSha256;
  await page.screenshot({ path: path.join(run, 'mobile.png'), fullPage: true }); evidence.passed = true;
} catch (error) {
  evidence.passed = false; evidence.diagnostic = String(error.message).split('\n')[0].replace(/https?:\/\/\S+/gu, '[URL_REDACTED]').slice(0, 300);
  process.exitCode = 1;
} finally {
  await browser?.close(); await stopChildProcesses([server], { graceMs: 5000 }); await log.close();
  await writeFile(path.join(run, 'evidence.json'), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence));
}
