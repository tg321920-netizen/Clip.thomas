// Real mobile UI -> HTTP upload -> ingest worker -> Whisper -> media worker -> MP4.
// No network interception, fabricated job statuses or external publication.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp, open, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { IngestJobStore } from '../services/ingest/IngestJobStore.mjs';
import { validateMp4 } from '../services/media-processing/MediaValidationService.mjs';

const output = path.resolve(process.env.CLIPFORGE_TEST_OUTPUT || 'artifacts/mobile-upload');
await mkdir(output, { recursive: true });
const runDirectory = await mkdtemp(path.join(output, 'run-'));
const storage = path.join(runDirectory, 'storage');
let video = process.env.CLIPFORGE_TEST_VIDEO;
if (!video) {
  const fixtureRoot = path.resolve('artifacts/live-clipping');
  const evidence = JSON.parse(await readFile(path.join(fixtureRoot, 'evidence.json'), 'utf8'));
  const project = JSON.parse(await readFile(path.join(fixtureRoot, 'storage/projects', `${evidence.result.projectId}.json`), 'utf8'));
  video = path.join(fixtureRoot, 'storage/uploads', project.clipsOrigin.projectId, 'source.mp4');
}
process.env.CLIPFORGE_STORAGE_DIR = storage;
const ingests = new IngestJobStore();
const cancelledCapture = await ingests.create({ url: 'https://example.invalid/authorized-fixture', mode: 'STREAM' });
await ingests.cancel(cancelledCapture.id);
const port = Number(process.env.CLIPFORGE_TEST_PORT || 3120);
const base = `http://127.0.0.1:${port}`;
const log = await open(path.join(runDirectory, 'runtime.log'), 'w');
const runtime = spawn(process.execPath, ['scripts/render-runtime-free.mjs'], {
  detached: true,
  stdio: ['ignore', log.fd, log.fd],
  env: { ...process.env, PORT: String(port), CLIPFORGE_STORAGE_DIR: storage,
    CLIPFORGE_MEDIA_STORAGE_PROVIDER: 'local',
    CLIPFORGE_REDIS_URL: '', REDIS_URL: '', CLIPFORGE_AGENT_ENABLED: 'false',
    CLIPFORGE_AGENT_REAL_PUBLISHING: 'false', CLIPFORGE_CONTENT_REAL_PUBLISHING: 'false',
    CLIPFORGE_SMART_PUBLISH_ON_BOOT: 'false', CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS: 'false',
    CLIPFORGE_ANALYSIS_PROVIDER: 'heuristic', CLIPFORGE_AUTOEDIT_PROVIDER: 'heuristic',
    WHISPER_LANGUAGE: 'en', CLIPFORGE_FREE_WORKER_POLL_MS: '1000' },
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (runtime.exitCode !== null) throw new Error(`Runtime exited: ${runtime.exitCode}`);
    try {
      const response = await fetch(`${base}/api/health`);
      const health = await response.json();
      if (response.ok && health.mediaReady && health.publishing === 'OFF') { ready = true; break; }
    } catch { /* Wait for the child server. */ }
    await delay(250);
  }
  assert.ok(ready, 'Actual supervised web/media runtime is ready');
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Reanudar importación', exact: true }).waitFor();
  console.log('Persistent cancelled capture is resumable from history');
  await page.getByRole('button', { name: 'CREAR MEJORES CLIPS', exact: true }).click();
  const form = page.getByRole('region', { name: 'CREAR MEJORES CLIPS', exact: true });
  console.log('Uploading authorized source through mobile UI');
  await form.locator('input[type=file]').setInputFiles(video);
  await form.getByRole('button', { name: 'Subir video', exact: true }).click();
  await page.getByRole('button', { name: 'Crear 3 clips de aprox. 45 s', exact: true }).waitFor();
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find(item => item.textContent === 'Crear 3 clips de aprox. 45 s');
    return button && !button.disabled;
  }, undefined, { timeout: 60000 });
  console.log('Source ingested and clip controls enabled');
  await page.getByLabel('Cantidad de clips', { exact: true }).fill('1');
  await page.getByLabel('Duración aproximada de cada clip en segundos', { exact: true }).fill('30');
  await page.getByLabel('Tipo de contenido', { exact: true }).selectOption('PODCAST');
  const queued = page.waitForResponse(response => response.url() === `${base}/api/media/jobs` && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Crear 1 clip de aprox. 30 s', exact: true }).click();
  const submitted = await (await queued).json();
  assert.ok(submitted.job?.id, 'UI enqueued an actual media job');
  console.log('Actual media job queued', submitted.job.id);
  let completed;
  for (let attempt = 0; attempt < 300; attempt++) {
    const response = await page.request.get(`${base}/api/media/jobs/${submitted.job.id}`);
    const { job } = await response.json();
    if (['FAILED', 'WAITING_RESOURCE'].includes(job?.status)) throw new Error(`Real media worker: ${job.status}: ${job.error}`);
    if (job?.status === 'READY') { completed = job; break; }
    await delay(1000);
  }
  assert.ok(completed, 'Real worker produced a READY result');
  const result = completed.result.clips[0];
  const downloadLink = page.locator(`a[href="${result.downloadUrl}"]`);
  await downloadLink.waitFor({ timeout: 15000 });
  const [download] = await Promise.all([page.waitForEvent('download'), downloadLink.click()]);
  const downloadedPath = path.join(runDirectory, 'downloaded.mp4');
  await download.saveAs(downloadedPath);
  const validation = await validateMp4(downloadedPath, { width: 1080, height: 1920, duration: result.duration, requireAudio: true });
  const player = page.locator(`video[src="${result.sourceUrl}"]`);
  await player.evaluate(async element => { element.muted = true; await element.play(); });
  await page.waitForFunction(src => {
    const player = [...document.querySelectorAll('video')].find(element => element.getAttribute('src') === src);
    return player?.currentTime > 0 && player.videoWidth === 1080 && !player.error;
  }, result.sourceUrl, { timeout: 15000 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, 'mobile-real-result.png'), fullPage: true });
  await writeFile(path.join(output, 'evidence.json'), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), mocks: false, viewport: '393x851', storage, jobId: completed.id, projectId: completed.projectId, download: downloadedPath, validation, browserPlayback: true, publication: 'OFF' }, null, 2));
  console.log('Real mobile upload / workers / Whisper / MP4 / playback PASSED', completed.id);
} finally {
  await browser?.close();
  const exited = once(runtime, 'exit');
  try { process.kill(-runtime.pid, 'SIGTERM'); } catch { /* Already exited. */ }
  let timer;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(() => {
    try { process.kill(-runtime.pid, 'SIGKILL'); } catch { /* Already exited. */ }
    resolve();
  }, 5000); })]);
  clearTimeout(timer);
  await log.close();
}
