import { spawn } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { constants, existsSync } from "node:fs";
import path from "node:path";

const storageRoot = path.resolve(
  process.env.CLIPFORGE_STORAGE_DIR?.trim() || "/tmp/clipforge",
);
const runtimeHome = path.resolve(
  process.env.CLIPFORGE_RUNTIME_HOME?.trim() || path.join(storageRoot, ".runtime-home"),
);
const port = String(process.env.PORT || "10000");
const loopDelayMs = Math.max(
  10_000,
  clampInteger(
    process.env.CLIPFORGE_FREE_WORKER_POLL_MS || 10_000,
    1000,
    60000,
  ),
);
const bundledEspeakRoot = path.resolve(process.cwd(), ".runtime", "espeak");
const bundledEspeakCommand = path.join(bundledEspeakRoot, "bin", "espeak-ng");
const bundledEspeakData = path.join(bundledEspeakRoot, "share", "espeak-ng-data");
const bundledYtDlp = path.resolve(process.cwd(), ".runtime", "bin", "yt-dlp");

await mkdir(storageRoot, { recursive: true });
await mkdir(runtimeHome, { recursive: true });
process.env.HOME = runtimeHome;

if (!process.env.ESPEAK_NG_PATH?.trim() && existsSync(bundledEspeakCommand)) {
  process.env.ESPEAK_NG_PATH = bundledEspeakCommand;
}
if (!process.env.ESPEAK_DATA_PATH?.trim() && existsSync(bundledEspeakData)) {
  process.env.ESPEAK_DATA_PATH = bundledEspeakData;
}
if (!process.env.YTDLP_PATH?.trim() && existsSync(bundledYtDlp)) {
  process.env.YTDLP_PATH = bundledYtDlp;
}

if (process.argv.includes("--check")) {
  await verifyRuntime();
  process.exit(0);
}

let shuttingDown = false;
let webChild = null;
let ingestChild = null;
let activeWorker = null;

const workerScripts = [
  "scripts/autopilot-worker.mjs",
  "scripts/agent-worker.mjs",
  "scripts/transcription-worker.mjs",
  "scripts/analysis-worker.mjs",
  "scripts/autoedit-worker.mjs",
  "scripts/render-worker.mjs",
  "scripts/news-worker.mjs",
  "scripts/owned-content-worker.mjs",
  "scripts/publishing-worker.mjs",
  "scripts/analytics-worker.mjs",
];

webChild = spawnNode(
  ["node_modules/next/dist/bin/next", "start", "-H", "0.0.0.0", "-p", port],
  "web",
);
ingestChild = spawnNode(["scripts/ingest-worker.mjs"], "ingest");

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

void workerLoop();

async function workerLoop() {
  while (!shuttingDown) {
    for (const script of workerScripts) {
      if (shuttingDown) return;
      const result = await runWorkerOnce(script);
      if (result.code !== 0) {
        console.error(
          `[free-runtime] ${script} exited with code ${result.code ?? "?"}; continuing sequential loop.`,
        );
        await sleep(Math.max(loopDelayMs, 5000));
      }
    }
    await sleep(loopDelayMs);
  }
}

function spawnNode(args, label) {
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(`[free-runtime] ${label} failed to start`, error);
    if (!shuttingDown) shutdown("SIGTERM", 1);
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    console.error(
      `[free-runtime] ${label} exited unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"}).`,
    );
    shutdown("SIGTERM", Number.isInteger(code) && code !== 0 ? code : 1);
  });

  return child;
}

function runWorkerOnce(script) {
  return new Promise((resolve) => {
    activeWorker = spawn(process.execPath, [script, "--once"], {
      env: process.env,
      stdio: "inherit",
      shell: false,
    });

    activeWorker.on("error", (error) => {
      console.error(`[free-runtime] ${script} failed to start`, error);
      activeWorker = null;
      resolve({ code: 1, signal: null });
    });

    activeWorker.on("exit", (code, signal) => {
      activeWorker = null;
      resolve({ code, signal });
    });
  });
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("[free-runtime] shutting down...");

  for (const child of [activeWorker, ingestChild, webChild]) {
    if (child && !child.killed) child.kill(signal);
  }

  const timer = setTimeout(() => {
    for (const child of [activeWorker, ingestChild, webChild]) {
      if (child && !child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 10_000);
  timer.unref();

  const pending = [activeWorker, ingestChild, webChild]
    .filter(Boolean)
    .map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", resolve);
        }),
    );

  Promise.all(pending).finally(() => process.exit(exitCode));
}

async function verifyRuntime() {
  const commands = [
    [process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-version"], "FFmpeg"],
    [process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-version"], "FFprobe"],
    [process.env.ESPEAK_NG_PATH?.trim() || "espeak-ng", ["--version"], "espeak-ng"],
    [
      process.env.WHISPER_CPP_COMMAND?.trim() || "whisper-cli",
      ["--help"],
      "whisper.cpp CLI",
    ],
  ];

  for (const [command, args, label] of commands) await runCheck(command, args, label);

  const modelPath = String(process.env.WHISPER_CPP_MODEL_PATH || "").trim();
  if (!modelPath) throw new Error("WHISPER_CPP_MODEL_PATH is not configured.");
  await access(modelPath, constants.R_OK);

  const espeakDataPath = String(process.env.ESPEAK_DATA_PATH || "").trim();
  if (espeakDataPath) {
    await access(espeakDataPath, constants.R_OK);
    console.log(`[free-runtime] eSpeak NG data ready: ${espeakDataPath}`);
  } else {
    console.log("[free-runtime] eSpeak NG uses its system-installed data path.");
  }

  const ytdlp = process.env.YTDLP_PATH?.trim() || (existsSync(bundledYtDlp) ? bundledYtDlp : "yt-dlp");
  try {
    await runCheck(ytdlp, ["--version"], "yt-dlp");
    console.log(`[free-runtime] yt-dlp ready: ${ytdlp}`);
  } catch (error) {
    console.warn(`[free-runtime] yt-dlp unavailable; only direct media URLs can be imported. ${error.message}`);
  }

  console.log(`[free-runtime] whisper.cpp model ready: ${modelPath}`);
  console.log("[free-runtime] media runtime check passed.");
}

function runCheck(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", "ignore", "pipe"],
      shell: false,
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(new Error(`${label} is unavailable: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} check failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function clampInteger(value, min, max) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}
