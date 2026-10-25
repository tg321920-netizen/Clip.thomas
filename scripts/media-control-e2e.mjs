// Actual mobile controls, corrupt metadata, cancellation, restart and MP4.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { JobStore } from "../services/JobStore.mjs";
import { LocalNeuralNarrationProvider } from "../services/owned-content/LocalNeuralNarrationProvider.mjs";
import { runMedia } from "../services/media-processing/MediaValidationService.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
import { hashFile } from "../services/ingest/ResumableUploadStore.mjs";
import { ClipLibraryService } from "../services/storage/ClipLibraryService.mjs";
import { R2ObjectStore, readR2Config } from "../services/storage/R2ObjectStore.mjs";
import { verifySubtitleFrame, selectSubtitleReviewCue } from "./verify-subtitle-frame.mjs";

const cloudConfig = process.argv.includes("--r2") ? readR2Config() : null;
if (process.argv.includes("--r2")) assert.ok(cloudConfig, "R2 is not configured; its real read cannot be certified");
const parent = path.resolve("artifacts/media-control"); await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "run-"));
process.env.CLIPFORGE_STORAGE_DIR = path.join(directory, "storage");
process.env.CLIPFORGE_MEDIA_STORAGE_PROVIDER = "local";
process.env.CLIPFORGE_MEDIA_WIDTH = "1080"; process.env.CLIPFORGE_MEDIA_HEIGHT = "1920";
for (const key of ["CLIPFORGE_REDIS_URL", "REDIS_URL"]) delete process.env[key];
for (const key of ["CLIPFORGE_AGENT_ENABLED", "CLIPFORGE_AGENT_REAL_PUBLISHING", "CLIPFORGE_CONTENT_REAL_PUBLISHING", "CLIPFORGE_SMART_PUBLISH_ON_BOOT", "CLIPFORGE_STORY_EXTERNAL_AUTHORIZED"]) process.env[key] = "false";
const story = JSON.parse(await readFile(new URL("./fixtures/spanish-reflections.json", import.meta.url), "utf8"))[1];
const text = story.scenes.join(" ");
const raw = path.join(directory, "narration.wav"), narration = path.join(directory, "narration-upload.wav");
await new LocalNeuralNarrationProvider().synthesize({ text, outputPath: raw });
await runMedia("ffmpeg", ["-v", "error", "-y", "-i", raw, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", narration]);
const store = new JobStore();
const damaged = await store.enqueueMedia("MEDIA_STORY", randomUUID(), {});
await writeFile(path.join(process.env.CLIPFORGE_STORAGE_DIR, "jobs", `${damaged.id}.json`), "{interrupted metadata fixture");
const port = Number(process.env.CLIPFORGE_TEST_PORT || 3149), base = `http://127.0.0.1:${port}`;
const serverLog = await open(path.join(directory, "server.log"), "w");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: process.env, stdio: ["ignore", serverLog.fd, serverLog.fd] });
const workers = []; let browser, page;

async function until(operation, message, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await operation(); if (value) return value; await delay(150); }
  throw new Error(message);
}
async function worker(name) {
  const log = await open(path.join(directory, `${name}.log`), "w");
  const child = spawn(process.execPath, ["scripts/media-worker.mjs", "--once"], { env: process.env, stdio: ["ignore", log.fd, log.fd] });
  const exit = new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code, signal) => resolve({ code, signal })); });
  const item = { child, exit, log, logPath: path.join(directory, `${name}.log`) }; workers.push(item); return item;
}
async function encoderPid(item) {
  const log = await readFile(item.logPath, "utf8");
  for (const match of [...log.matchAll(/^\[media-native\] (.+)$/gm)].reverse()) {
    const child = JSON.parse(match[1]);
    if (!child.encoder) continue;
    try { process.kill(child.pid, 0); return child.pid; } catch { /* Already finished. */ }
  }
  return null;
}
async function assertStopped(item, pid) {
  const result = await until(() => item.child.exitCode !== null ? item.exit : null, "Worker did not stop", 15000);
  assert.equal(result.code, 0); assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
}

try {
  await until(async () => { try { const r = await fetch(`${base}/api/health`); return r.ok && (await r.json()).publishing === "OFF"; } catch { return false; } }, "Review server did not start", 20000);
  const history = await (await fetch(`${base}/api/media/jobs`)).json();
  assert.equal(history.issues.length, 1); assert.equal(history.issues[0].id, damaged.id);
  assert.equal((await fetch(`${base}/api/media/jobs/${damaged.id}`)).status, 409);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  page = await context.newPage(); const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByText(/Hay 1 trabajo con metadatos dañados/).waitFor();
  const form = page.getByRole("region", { name: "CREAR HISTORIA CON IA", exact: true });
  await form.getByLabel("Tema o idea", { exact: true }).fill("Reflexión — comprobación de recuperación");
  await form.getByLabel("Escenas", { exact: true }).selectOption("3");
  await form.getByLabel("Voz de narración", { exact: true }).selectOption("UPLOAD");
  await form.getByLabel(/^Relato completo/).fill(text);
  await form.getByLabel("Mi narración en español", { exact: true }).setInputFiles(narration);
  await form.getByRole("checkbox", { name: "Tengo derechos de uso sobre los recursos que subo.", exact: true }).check();
  const submitted = page.waitForResponse(response => response.url().endsWith("/api/media/jobs") && response.request().method() === "POST");
  await form.getByRole("button", { name: "Crear video con fotos gratuitas", exact: true }).click();
  assert.equal((await submitted).status(), 202);
  const [job] = await store.listMedia(); assert.ok(job?.id);
  assert.equal(await hashFile(path.join(process.env.CLIPFORGE_STORAGE_DIR, job.payload.narrationAudio)), await hashFile(narration));
  const first = await worker("cancelled-worker");
  const firstPid = await until(async () => { const j = await store.get(job.id); return j.stage === "SCENES" && j.status === "PROCESSING" ? encoderPid(first) : null; }, "No active scene encoder to cancel", 240000);
  const card = page.locator("article");
  const cancelled = page.waitForResponse(response => response.url().endsWith(`/api/media/jobs/${job.id}`) && response.request().method() === "POST");
  await card.getByRole("button", { name: "Cancelar", exact: true }).click();
  assert.ok((await cancelled).ok());
  await until(async () => { const j = await store.get(job.id); return j.status === "CANCELLED" && !j.cancellationPending; }, "Cancellation did not release the renderer", 15000);
  await assertStopped(first, firstPid);
  const cancelledJob = await store.get(job.id); assert.ok(!cancelledJob.result);
  const queued = page.waitForResponse(response => response.url().endsWith(`/api/media/jobs/${job.id}`) && response.request().method() === "POST");
  await card.getByRole("button", { name: "Reanudar", exact: true }).click();
  assert.equal((await queued).status(), 202);
  const resumedJob = await store.get(job.id); assert.notEqual(resumedJob.generation, job.generation);
  const interrupted = await worker("interrupted-worker");
  const secondPid = await until(async () => { const j = await store.get(job.id); return j.stage === "SCENES" && j.status === "PROCESSING" ? encoderPid(interrupted) : null; }, "No active encoder to restart", 240000);
  interrupted.child.kill("SIGTERM"); await assertStopped(interrupted, secondPid);
  assert.equal((await store.get(job.id)).status, "QUEUED");
  assert.equal((await store.get(job.id)).stage, "RECOVERED");
  const finalWorker = await worker("completed-worker");
  await until(() => finalWorker.child.exitCode !== null ? finalWorker.exit : null, "Resumed worker did not finish", 600000);
  assert.equal(finalWorker.child.exitCode, 0);
  const completed = await store.get(job.id); assert.equal(completed.status, "READY", completed.error);
  assert.ok(completed.result.recovery.reusedScenes >= 1);
  assert.ok(completed.result.validation.duration >= 30 && completed.result.validation.duration <= 45);
  assert.ok(completed.result.validation.fullDecode && completed.result.validation.audioCodec === "aac");
  const project = await loadProjectFile(job.projectId);
  assert.equal(project.story.subtitleCues.map(c => c.text).join(" "), text);
  await page.reload({ waitUntil: "networkidle" });
  const player = page.locator(`video[src="${completed.result.sourceUrl}"]`);
  await player.evaluate(async video => { video.muted = true; await video.play(); });
  await page.waitForFunction(() => [...document.querySelectorAll("article video")].some(video => video.currentTime > 0 && video.videoWidth === 1080 && !video.error));
  await player.evaluate(video => video.pause());
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("article").getByRole("link", { name: "Descargar MP4", exact: true }).click()]);
  const filename = path.join(directory, "reflexion-recuperada.mp4"); await download.saveAs(filename);
  assert.equal(await hashFile(filename), await hashFile(path.join(process.env.CLIPFORGE_STORAGE_DIR, completed.result.relativePath)));
  assert.equal((await page.request.get(`${base}${completed.result.sourceUrl}`, { headers: { Range: "bytes=0-1023" } })).status(), 206);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, "mobile-review.png"), fullPage: true });
  const subtitles = await verifySubtitleFrame({ file: filename, cue: selectSubtitleReviewCue(project.story.subtitleCues), width: 1080, height: 1920, captionRegion: { top: 0.74, bottom: 0.86 }, output: path.join(directory, "subtitle-review") });
  let cloud = { tested: false };
  if (process.argv.includes("--r2")) {
    const previous = JSON.parse(await readFile("artifacts/spanish-reflections/run-jksNXm/mobile-refined/evidence.json", "utf8"));
    const media = await new ClipLibraryService({ store: new R2ObjectStore({ config: cloudConfig }) }).source(previous.r2.id); const digest = createHash("sha256"); let bytes = 0;
    for await (const chunk of media.body) { digest.update(chunk); bytes += chunk.length; }
    assert.equal(digest.digest("hex"), await hashFile("artifacts/spanish-reflections/run-jksNXm/una-pausa-tambien-cuenta-optimizado.mp4"));
    cloud = { tested: true, existingClipId: previous.r2.id, fullDownloadVerified: true, bytes, writes: false };
  }
  const evidence = { passed: true, testedAt: new Date().toISOString(), directory, filename, jobId: job.id, projectId: job.projectId, generationChangedOnResume: true, actualNativeCancellation: true, actualGracefulRestart: true, nativePidsStopped: [firstPid, secondPid], corruptMetadataIsolated: true, originalNarrationPreserved: true, uiMocks: false, physicalAndroid: false, viewport: "393x851", recovery: completed.result.recovery, validation: completed.result.validation, subtitles, cloud, publishing: "OFF", editorialApproval: "OWNER_REVIEW_REQUIRED", narrationSource: "Local Kokoro, uploaded as a recording fixture; not a human recording" };
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  await writeFile(path.join(parent, "latest.json"), JSON.stringify({ directory }));
  console.log(JSON.stringify({ passed: true, filename, duration: completed.result.validation.duration, recovery: completed.result.recovery, cloud, evidence: path.join(directory, "evidence.json") }));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }); await writeFile(path.join(directory, "failure.txt"), await page.locator("body").innerText()); }
  throw error;
} finally {
  await browser?.close();
  for (const item of workers) { if (item.child.exitCode === null && item.child.signalCode === null) { item.child.kill("SIGTERM"); const timer = setTimeout(() => item.child.kill("SIGKILL"), 4000); await item.exit; clearTimeout(timer); } await item.log.close(); }
  if (server.exitCode === null) { const exited = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 4000); await exited; clearTimeout(timer); }
  await serverLog.close();
}
