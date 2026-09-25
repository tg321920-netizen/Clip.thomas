import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { WhisperCppProvider } from "../services/transcription/WhisperCppProvider.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-whisper-cpp-"));
const audioPath = path.join(root, "speech.wav");
const outputDir = path.join(root, "out");

try {
  await run(
    process.env.ESPEAK_NG_PATH?.trim() || "espeak-ng",
    ["-v", "es", "-s", "135", "-w", audioPath, "Hola mundo, esta es una prueba de ClipForge."],
    "espeak-ng",
  );

  const provider = new WhisperCppProvider({ language: "es", threads: 1 });
  const result = await provider.transcribe(audioPath, outputDir);

  if (!Array.isArray(result.segments) || result.segments.length === 0) {
    throw new Error("whisper.cpp smoke test produced no transcript segments.");
  }
  if (!String(result.text || "").trim()) {
    throw new Error("whisper.cpp smoke test produced empty transcript text.");
  }

  console.log(
    JSON.stringify({
      provider: result.provider,
      model: result.model,
      language: result.language,
      segments: result.segments.length,
      text: result.text,
    }),
  );
} finally {
  await rm(root, { recursive: true, force: true });
}

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => reject(new Error(`${label} unavailable: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} failed: ${stderr.trim() || `exit ${code}`}`));
    });
  });
}
