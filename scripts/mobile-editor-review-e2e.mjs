// Actual existing jobs, HTTP media routes, private R2 and browser playback.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

if (!process.env.CLIPFORGE_REVIEW_EVIDENCE) throw new Error("Select the completed local acceptance evidence with CLIPFORGE_REVIEW_EVIDENCE.");
const input = JSON.parse(await readFile(process.env.CLIPFORGE_REVIEW_EVIDENCE, "utf8"));
assert.equal(input.languages.length, 2);
assert.ok(input.languages.every(item => item.status === "READY" && item.r2?.id));
const output = path.join(input.directory, "mobile"); await mkdir(output, { recursive: true });
const port = Number(process.env.CLIPFORGE_TEST_PORT || 3144), base = `http://127.0.0.1:${port}`;
const env = { ...process.env, CLIPFORGE_STORAGE_DIR: input.storage, CLIPFORGE_MEDIA_STORAGE_PROVIDER: "r2", CLIPFORGE_REDIS_URL: "", REDIS_URL: "", CLIPFORGE_AGENT_ENABLED: "false", CLIPFORGE_AGENT_REAL_PUBLISHING: "false", CLIPFORGE_CONTENT_REAL_PUBLISHING: "false", CLIPFORGE_SMART_PUBLISH_ON_BOOT: "false", CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS: "false" };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(port)], { env, stdio: ["ignore", "ignore", "pipe"] });
let serverError = "", browser, page;
const errors = [];
const consoleErrors = [];
const failedResources = [];
server.stderr.on("data", chunk => { serverError = (serverError + chunk).slice(-2000); });
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode !== null) throw new Error(`Review server stopped (${server.exitCode})`);
    try { const response = await fetch(`${base}/api/health`); const health = await response.json(); if (response.ok && health.publishing === "OFF") { ready = true; break; } } catch { /* Startup only. */ }
    await delay(250);
  }
  assert.ok(ready, "Actual review server must pass health");
  const historyResponse = await fetch(`${base}/api/media/jobs`);
  assert.ok(historyResponse.ok, `Actual job history failed (${historyResponse.status})`);
  const history = await historyResponse.json();
  assert.ok(input.languages.every(item => history.jobs.some(job => job.id === item.jobId && job.status === "READY")), "Both completed jobs must be visible through HTTP before opening the browser");
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", response => { if (response.status() >= 400) failedResources.push({ path: new URL(response.url()).pathname, status: response.status() }); });
  await page.goto(base, { waitUntil: "networkidle" });
  const checks = [];
  for (const item of input.languages) {
    const clip = item.clips[0];
    const player = page.locator(`video[src="${clip.sourceUrl}"]`);
    await player.evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(src => { const video = [...document.querySelectorAll("video")].find(element => element.getAttribute("src") === src); return video?.currentTime > 0 && video.videoWidth === 360 && !video.error; }, clip.sourceUrl, { timeout: 15000 });
    await player.evaluate(video => video.pause());
    const [download] = await Promise.all([page.waitForEvent("download"), page.locator(`a[href="${clip.downloadUrl}"]`).click()]);
    const localPath = path.join(output, `${item.language}-download.mp4`); await download.saveAs(localPath);
    const digest = file => readFile(file).then(bytes => createHash("sha256").update(bytes).digest("hex"));
    assert.equal(await digest(localPath), await digest(path.join(input.storage, clip.relativePath)));
    const remotePath = `/api/media/library/${item.r2.id}/source`;
    const ranged = await page.request.get(`${base}${remotePath}`, { headers: { Range: "bytes=0-1023" } });
    assert.equal(ranged.status(), 206); assert.equal((await ranged.body()).length, 1024);
    const library = page.getByRole("region", { name: "Clips guardados en nube" });
    const remotePlayer = library.locator(`video[src="${remotePath}"]`);
    await remotePlayer.evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(src => { const video = [...document.querySelectorAll("video")].find(element => element.getAttribute("src") === src); return video?.currentTime > 0 && !video.error; }, remotePath, { timeout: 15000 });
    await remotePlayer.evaluate(video => video.pause());
    checks.push({ language: item.language, actualLocalPlayback: true, actualDownloadMatches: true, actualR2Playback: true, actualR2HttpRange: true });
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, "review.png"), fullPage: true });
  await page.goto(`${base}/autopilot`, { waitUntil: "networkidle" });
  const form = page.getByRole("group", { name: "Preparar clips con el agente" });
  await form.getByLabel("Video original para el agente").selectOption(input.languages[0].sourceProjectId);
  assert.equal(await form.getByRole("checkbox").isChecked(), false);
  assert.equal(await form.getByRole("button", { name: "Preparar 5 clips con IA", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, "evidence.json"), JSON.stringify({ passed: true, testedAt: new Date().toISOString(), viewport: "393x851", mocks: false, checks, rightsRequired: true, legacyMetadataDoesNotCrashPage: true, consoleErrors, failedResources, publishing: "OFF", physicalAndroid: false }, null, 2));
  console.log("Actual bilingual local/R2 mobile playback and downloads passed");
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, "failure.png"), fullPage: true });
    await writeFile(path.join(output, "failure.txt"), `URL: ${page.url()}\n${await page.locator("body").innerText()}`);
    await writeFile(path.join(output, "browser-errors.json"), JSON.stringify({ errors, consoleErrors }, null, 2));
  }
  console.error("Review server stderr tail:", serverError);
  throw error;
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once("exit", resolve));
    server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000);
    await exited; clearTimeout(timer);
  }
}
