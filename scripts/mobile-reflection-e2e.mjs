// Real mobile form -> audio upload -> persisted job -> actual worker -> MP4/R2.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, open, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
import { hashFile } from "../services/ingest/ResumableUploadStore.mjs";
import { validateMp4, runMedia } from "../services/media-processing/MediaValidationService.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
import { ClipLibraryService } from "../services/storage/ClipLibraryService.mjs";
import { verifySubtitleFrame, selectSubtitleReviewCue } from "./verify-subtitle-frame.mjs";

const latest = JSON.parse(await readFile("artifacts/spanish-reflections/latest.json", "utf8"));
const first = JSON.parse(await readFile(path.join(latest.directory, "evidence.json"), "utf8"));
assert.ok(first.passed && first.r2 && first.secondNarration.filename);
const stories = JSON.parse(await readFile(new URL("./fixtures/spanish-reflections.json", import.meta.url), "utf8"));
const directory = path.resolve(process.env.CLIPFORGE_MOBILE_OUTPUT || path.join(first.directory, "mobile")); await mkdir(directory, { recursive: true });
const deliveryName = process.env.CLIPFORGE_MOBILE_DELIVERY_NAME || "una-pausa-tambien-cuenta.mp4";
assert.match(deliveryName, /^[a-z0-9-]+\.mp4$/);
process.env.CLIPFORGE_STORAGE_DIR = first.storage;
process.env.CLIPFORGE_MEDIA_WIDTH = "1080"; process.env.CLIPFORGE_MEDIA_HEIGHT = "1920";
for (const name of ["CLIPFORGE_REDIS_URL", "REDIS_URL"]) delete process.env[name];
for (const name of ["CLIPFORGE_AGENT_ENABLED", "CLIPFORGE_AGENT_REAL_PUBLISHING", "CLIPFORGE_CONTENT_REAL_PUBLISHING", "CLIPFORGE_SMART_PUBLISH_ON_BOOT", "CLIPFORGE_STORY_EXTERNAL_AUTHORIZED"]) process.env[name] = "false";
const port = Number(process.env.CLIPFORGE_TEST_PORT || 3146), base = `http://127.0.0.1:${port}`;
const runtimeLog = await open(path.join(directory, "server.log"), "w");
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env: process.env, stdio: ["ignore", runtimeLog.fd, runtimeLog.fd] });
let browser, page; const errors = [];
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("Review server stopped before readiness");
    try { const response = await fetch(`${base}/api/health`); const health = await response.json(); if (response.ok && health.publishing === "OFF") { ready = true; break; } } catch { /* Startup. */ }
    await delay(200);
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  const reviewResumed = process.env.CLIPFORGE_MOBILE_RESUME === "true";
  let submitted, uploaded, narrationPreviewPlayed = false;
  if (reviewResumed) {
    const checkpoint = JSON.parse(await readFile(path.join(directory, "submission.json"), "utf8"));
    assert.equal(checkpoint.browserClosedDuringRender, true);
    submitted = (await (await page.request.get(`${base}/api/media/jobs/${checkpoint.jobId}`)).json()).job;
    uploaded = checkpoint.uploaded;
    narrationPreviewPlayed = checkpoint.narrationPreviewPlayed === true;
    assert.equal(submitted.payload.narrationAudio, uploaded.relativePath);
    assert.equal(await hashFile(path.join(first.storage, uploaded.relativePath)), await hashFile(first.secondNarration.filename));
  } else {
    await page.getByRole("button", { name: "CREAR HISTORIA CON IA", exact: true }).click();
    const form = page.getByRole("region", { name: "CREAR HISTORIA CON IA", exact: true });
    await form.getByLabel("Tema o idea", { exact: true }).fill(`${stories[1].title}${process.env.CLIPFORGE_STORY_TITLE_SUFFIX || ""}`);
    await form.getByLabel("Voz de narración", { exact: true }).selectOption("UPLOAD");
    await form.getByLabel(/^Relato completo/).fill(stories[1].scenes.join(" "));
    await form.getByLabel("Mi narración en español", { exact: true }).setInputFiles(first.secondNarration.filename);
    const preview = form.getByLabel("Escuchar mi narración antes de crear el video", { exact: true });
    await preview.evaluate(async audio => { audio.muted = true; await audio.play(); });
    await page.waitForFunction(() => { const audio = document.querySelector("audio"); return audio?.currentTime > 0 && audio.duration > 30 && !audio.error; });
    await preview.evaluate(audio => audio.pause()); narrationPreviewPlayed = true;
    await page.screenshot({ path: path.join(directory, "narration-preview.png"), fullPage: true });
    await form.getByRole("checkbox", { name: "Tengo derechos de uso sobre los recursos que subo.", exact: true }).check();
    const before = new Set((await (await page.request.get(`${base}/api/media/jobs`)).json()).jobs.map(job => job.id));
    const audioUpload = page.waitForResponse(response => response.url().endsWith("/api/media/assets") && response.request().method() === "POST");
    const queued = page.waitForResponse(response => response.url().endsWith("/api/media/jobs") && response.request().method() === "POST");
    await form.getByRole("button", { name: "Crear video con fotos gratuitas", exact: true }).click();
    assert.ok((await audioUpload).ok()); assert.equal((await queued).status(), 202);
    // Chromium can evict inspector response bodies after a large binary upload.
    // Read the actual persisted job through HTTP instead of depending on CDP's cache.
    const created = (await (await page.request.get(`${base}/api/media/jobs`)).json()).jobs.filter(job => !before.has(job.id));
    assert.equal(created.length, 1);
    submitted = created[0];
    uploaded = { relativePath: submitted.payload.narrationAudio, sizeBytes: 0 }; assert.ok(uploaded.relativePath);
    uploaded.sizeBytes = (await stat(path.join(first.storage, uploaded.relativePath))).size;
    assert.ok(uploaded.sizeBytes > 4 * 1024 * 1024, "Actual WAV upload exercises the enlarged audio limit");
    assert.equal(await hashFile(path.join(first.storage, uploaded.relativePath)), await hashFile(first.secondNarration.filename));
    assert.ok(submitted?.id);
    assert.equal(submitted.payload.voiceMode, "UPLOAD"); assert.equal(submitted.payload.storyProfile, "SHORT_REFLECTION");
  }
  await page.close();
  await writeFile(path.join(directory, "submission.json"), JSON.stringify({ jobId: submitted.id, uploaded, narrationPreviewPlayed, browserClosedDuringRender: true }));
  if (submitted.status !== "READY") {
    const workerLog = await open(path.join(directory, "worker.log"), "w");
    const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ["scripts/media-worker.mjs", "--once"], { env: { ...process.env, CLIPFORGE_MEDIA_STORAGE_PROVIDER: "local" }, stdio: ["ignore", workerLog.fd, workerLog.fd] }); child.on("error", reject); child.on("exit", resolve); });
    await workerLog.close(); assert.equal(code, 0);
  }
  const job = (await (await fetch(`${base}/api/media/jobs/${submitted.id}`)).json()).job;
  assert.equal(job.status, "READY", job.error);
  const project = await loadProjectFile(job.projectId);
  assert.equal(project.story.voice.provider, "user-recording");
  assert.ok(job.result.validation.duration >= 30 && job.result.validation.duration <= 45);
  assert.equal(project.story.subtitleCues.map(cue => cue.text).join(" "), stories[1].scenes.join(" "));
  assert.equal(await hashFile(path.join(first.storage, uploaded.relativePath)), await hashFile(first.secondNarration.filename));
  const library = new ClipLibraryService(), saved = await library.archive(project, project.clips[0]); assert.ok(saved);
  page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "networkidle" });
  const checks = [];
  for (const item of [{ result: first.result, archive: first.r2, filename: "first-download.mp4" }, { result: job.result, archive: saved, filename: "una-pausa-tambien-cuenta.mp4" }]) {
    const player = page.locator(`video[src="${item.result.sourceUrl}"]`);
    await player.evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(src => { const video = [...document.querySelectorAll("video")].find(element => element.getAttribute("src") === src); return video?.currentTime > 0 && video.videoWidth === 1080 && !video.error; }, item.result.sourceUrl, { timeout: 15000 });
    await player.evaluate(video => video.pause());
    const card = page.locator("article").filter({ has: player });
    const [download] = await Promise.all([page.waitForEvent("download"), card.locator(`a[href="${item.result.downloadUrl}"]`).click()]);
    const filename = path.join(directory, item.filename); await download.saveAs(filename);
    assert.equal(await hashFile(filename), await hashFile(path.join(first.storage, item.result.relativePath)));
    const remotePath = `/api/media/library/${item.archive.id}/source`;
    const range = await page.request.get(`${base}${remotePath}`, { headers: { Range: "bytes=0-1023" } });
    assert.equal(range.status(), 206); assert.equal((await range.body()).length, 1024);
    const remote = page.getByRole("region", { name: "Clips guardados en nube" }).locator(`video[src="${remotePath}"]`);
    await remote.evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(src => { const video = [...document.querySelectorAll("video")].find(element => element.getAttribute("src") === src); return video?.currentTime > 0 && !video.error; }, remotePath, { timeout: 15000 });
    await remote.evaluate(video => video.pause());
    checks.push({ filename, actualLocalPlayback: true, actualR2Playback: true, downloadIntegrity: true, range: true });
  }
  const details = page.locator("article").filter({ has: page.locator(`video[src="${job.result.sourceUrl}"]`) }).getByText("Revisar escenas y procedencia", { exact: true });
  await details.click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(directory, "review.png"), fullPage: true });
  const file = path.join(directory, "una-pausa-tambien-cuenta.mp4");
  const validation = await validateMp4(file, { width: 1080, height: 1920, duration: job.result.validation.duration, requireAudio: true, requireAudibleNarration: true });
  const subtitleEvidence = await verifySubtitleFrame({ file, cue: selectSubtitleReviewCue(project.story.subtitleCues), width: 1080, height: 1920, captionRegion: { top: 0.74, bottom: 0.86 }, output: path.join(directory, "subtitle-review") });
  for (const scene of project.story.scenes) await runMedia("ffmpeg", ["-v", "error", "-y", "-ss", String(scene.startTime + scene.duration / 2), "-i", file, "-frames:v", "1", "-q:v", "3", path.join(directory, `scene-${scene.order}.jpg`)]);
  await copyFile(file, path.join(first.directory, deliveryName));
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify({ passed: true, testedAt: new Date().toISOString(), viewport: "393x851", mocks: false, physicalAndroid: false, reviewResumed, narrationPreviewPlayed, jobId: job.id, projectId: job.projectId, result: job.result, validation, voice: project.story.voice, alignment: project.story.narrationAlignment, uploadedNarrationSource: first.secondNarration.source, uploadBytes: uploaded.sizeBytes, browserClosedDuringRender: true, originalRecordingPreserved: true, checks, r2: saved, subtitleEvidence, publishing: "OFF" }, null, 2));
  console.log(JSON.stringify({ passed: true, file, duration: validation.duration, r2: saved.id, evidence: path.join(directory, "evidence.json") }));
} catch (error) {
  if (page && !page.isClosed()) { await page.screenshot({ path: path.join(directory, "failure.png"), fullPage: true }); await writeFile(path.join(directory, "failure.txt"), `${page.url()}\n${await page.locator("body").innerText()}\n${errors.join("\n")}`); }
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) { const exited = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM"); const timer = setTimeout(() => server.kill("SIGKILL"), 5000); await exited; clearTimeout(timer); }
  await runtimeLog.close();
}
