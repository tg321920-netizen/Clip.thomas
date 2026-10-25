// Real application routes, existing captured MP4s and private R2. No API mocks.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const inputPath = process.env.CLIPFORGE_REVIEW_EVIDENCE;
if (!inputPath) throw new Error("Indica CLIPFORGE_REVIEW_EVIDENCE con el resultado de las capturas reales.");
const input = JSON.parse(await readFile(inputPath, "utf8"));
assert.equal(input.status, "COMPLETED");
assert.ok(input.results?.length > 0 && input.results.every(item => item.archive?.status === "READY" && item.validation?.fullDecode));
const output = path.join(path.dirname(inputPath), "mobile"); await mkdir(output, { recursive: true });
const port = Number(process.env.CLIPFORGE_TEST_PORT || 3159), base = `http://127.0.0.1:${port}`;
// Isolate server startup from runtime Redis, scheduler and all publishing.
const env = { ...process.env, CLIPFORGE_REDIS_URL: "", REDIS_URL: "", VERCEL_ENV: "", CLIPFORGE_REQUIRE_OWNER_AUTH: "false",
  CLIPFORGE_AGENT_ENABLED: "false", CLIPFORGE_AGENT_REAL_PUBLISHING: "false", CLIPFORGE_CONTENT_REAL_PUBLISHING: "false",
  CLIPFORGE_SMART_PUBLISH_ON_BOOT: "false", CLIPFORGE_BOOTSTRAP_OWNED_CHANNELS: "false", CLIPFORGE_LIVE_MONITOR_ENABLED: "false" };
const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "--hostname", "127.0.0.1", "-p", String(port)], { env, stdio: ["ignore", "ignore", "pipe"] });
server.stderr.on("data", () => {}); // Framework logs are not evidence and can include sensitive runtime diagnostics.
let browser, page;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error("El servidor local de revisión no arrancó.");
    try { const response = await fetch(`${base}/api/health`); if (response.ok && (await response.json()).publishing === "OFF") { ready = true; break; } } catch { /* Startup only. */ }
    await delay(250);
  }
  assert.ok(ready);
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true, acceptDownloads: true });
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(base, { waitUntil: "domcontentloaded" });
  const library = page.getByRole("region", { name: "Clips guardados en nube" });
  const checks = [];
  const digest = async file => createHash("sha256").update(await readFile(file)).digest("hex");
  for (const [index, item] of input.results.entries()) {
    const src = item.archive.sourceUrl, player = library.locator(`video[src="${src}"]`);
    await player.waitFor({ timeout: 60000 });
    await player.evaluate(async video => { video.muted = true; await video.play(); });
    await page.waitForFunction(src => { const video = [...document.querySelectorAll("video")].find(element => element.getAttribute("src") === src);
      return video?.currentTime > 0.3 && video.videoWidth === 1080 && video.videoHeight === 1920 && !video.error; }, src, { timeout: 30000 });
    const playback = await player.evaluate(video => ({ duration: video.duration, time: video.currentTime, width: video.videoWidth, height: video.videoHeight }));
    await player.evaluate(video => video.pause());
    const ranged = await page.request.get(`${base}${src}`, { headers: { Range: "bytes=0-1023" } });
    assert.equal(ranged.status(), 206); assert.equal((await ranged.body()).length, 1024);
    const [download] = await Promise.all([page.waitForEvent("download"), library.locator(`a[href="${item.archive.downloadUrl}"]`).click()]);
    const downloaded = path.join(output, `${index + 1}-r2-download.mp4`); await download.saveAs(downloaded);
    assert.equal(await download.failure(), null);
    const sha256 = await digest(item.file); assert.equal(await digest(downloaded), sha256);
    checks.push({ archiveId: item.archive.id, actualR2Playback: playback, range206: true, downloadedBytesMatch: true, sha256 });
  }
  await page.screenshot({ path: path.join(output, "library.png"), fullPage: false });
  await page.getByRole("button", { name: "PEGAR URL O DIRECTO", exact: true }).click();
  await page.getByRole("button", { name: "Directo activo", exact: true }).click();
  await page.getByLabel("Enlace del canal o del directo").fill("https://kick.com/westcol");
  await page.getByLabel("Generar clips automáticamente", { exact: true }).check();
  await page.getByLabel("Cantidad total de clips del directo", { exact: true }).fill("10");
  await page.getByLabel("Elegir solo reacciones observadas del chat").check();
  assert.equal(await page.getByLabel("Comienzo del VOD (segundos)").inputValue(), "0");
  assert.equal(await page.getByLabel("Añadir subtítulos automáticos para revisar").isChecked(), false);
  assert.equal(await page.getByLabel("Tengo autorización para importar este material.").isChecked(), false);
  assert.equal(await page.getByRole("button", { name: "Capturar 180 segundos", exact: true }).isDisabled(), true);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: path.join(output, "capture-controls.png"), fullPage: false });
  await writeFile(path.join(output, "evidence.json"), JSON.stringify({ passed: true, checkedAt: new Date().toISOString(), mocks: false, viewport: "393x851",
    physicalAndroid: false, publishing: "OFF", captureStartedByUiTest: false, originalAudio: "VERIFIED_SEPARATELY_BY_FFPROBE_AND_FULL_DECODE", checks, noHorizontalOverflow: true, noJavaScriptErrors: true }, null, 2));
  // UI fixtures remain a separate test, never counted as real capture evidence.
  if (process.argv.includes("--ui-regressions")) {
    for (const script of ["scripts/mobile-live-e2e.mjs", "scripts/mobile-storage-e2e.mjs"]) {
      await new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [script], { env: { ...env, CLIPFORGE_TEST_BASE_URL: base }, stdio: ["ignore", "inherit", "inherit"] });
        child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error(`Falló ${script}`)));
      });
    }
  }
  console.info(JSON.stringify({ passed: true, actualPrivateClips: checks.length, output, physicalAndroid: false }));
} finally {
  await browser?.close();
  if (server.exitCode === null) {
    const exited = new Promise(resolve => server.once("exit", resolve)); server.kill("SIGTERM");
    const timer = setTimeout(() => server.kill("SIGKILL"), 5000); await exited; clearTimeout(timer);
  }
}
