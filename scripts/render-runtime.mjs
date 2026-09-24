import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const storageRoot = path.resolve(
  process.env.CLIPFORGE_STORAGE_DIR?.trim() || path.join(process.cwd(), "storage"),
);
const runtimeHome = path.resolve(
  process.env.CLIPFORGE_RUNTIME_HOME?.trim() || path.join(storageRoot, ".runtime-home"),
);
const port = String(process.env.PORT || "10000");

await mkdir(storageRoot, { recursive: true });
await mkdir(runtimeHome, { recursive: true });
process.env.HOME = runtimeHome;

if (process.argv.includes("--check")) {
  await verifyRuntime();
  process.exit(0);
}

const children = new Map();
let shuttingDown = false;

const processes = [
  ["transcription", ["scripts/transcription-worker.mjs"]],
  ["analysis", ["scripts/analysis-worker.mjs"]],
  ["autoedit", ["scripts/autoedit-worker.mjs"]],
  ["render", ["scripts/render-worker.mjs"]],
  ["news", ["scripts/news-worker.mjs"]],
  ["autopilot", ["scripts/autopilot-worker.mjs"]],
  ["publishing", ["scripts/publishing-worker.mjs"]],
  ["analytics", ["scripts/analytics-worker.mjs"]],
  [
    "web",
    [
      "node_modules/next/dist/bin/next",
      "start",
      "-H",
      "0.0.0.0",
      "-p",
      port,
    ],
  ],
];

for (const [name, args] of processes) {
  startChild(name, args);
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

function startChild(name, args) {
  const child = spawn(process.execPath, args, {
    env: process.env,
    stdio: "inherit",
    shell: false,
  });
  children.set(name, child);

  child.on("error", (error) => {
    console.error(`[runtime] ${name} failed to start`, error);
    if (!shuttingDown) shutdown("SIGTERM", 1);
  });

  child.on("exit", (code, signal) => {
    children.delete(name);
    if (shuttingDown) return;

    console.error(
      `[runtime] ${name} exited unexpectedly (code=${code ?? "none"}, signal=${signal ?? "none"}).`,
    );
    shutdown("SIGTERM", Number.isInteger(code) && code !== 0 ? code : 1);
  });
}

function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[runtime] shutting down ${children.size} processes...`);

  for (const child of children.values()) {
    if (!child.killed) child.kill(signal);
  }

  const timer = setTimeout(() => {
    for (const child of children.values()) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 15_000);
  timer.unref();

  Promise.all(
    [...children.values()].map(
      (child) =>
        new Promise((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) resolve();
          else child.once("exit", resolve);
        }),
    ),
  ).finally(() => process.exit(exitCode));
}

async function verifyRuntime() {
  const commands = [
    [process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-version"], "FFmpeg"],
    [process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-version"], "FFprobe"],
    [process.env.ESPEAK_NG_PATH?.trim() || "espeak-ng", ["--version"], "espeak-ng"],
    [process.env.WHISPER_COMMAND?.trim() || "whisper", ["--help"], "Whisper CLI"],
  ];

  for (const [command, args, label] of commands) {
    await runCheck(command, args, label);
  }

  console.log("[runtime] media runtime check passed.");
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
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      reject(new Error(`${label} is unavailable: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} check failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}
