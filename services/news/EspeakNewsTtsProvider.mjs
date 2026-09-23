import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";

export class EspeakNewsTtsProvider {
  constructor(options = {}) {
    this.name = "espeak-ng";
    this.command = options.command || process.env.ESPEAK_NG_PATH?.trim() || "espeak-ng";
    this.voice = options.voice || process.env.CLIPFORGE_NEWS_VOICE?.trim() || "es";
    this.speed = clampNumber(options.speed, 120, 220, Number(process.env.CLIPFORGE_NEWS_TTS_SPEED || 165));
  }

  async synthesize({ text, outputPath }) {
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    if (!clean) throw new Error("News narration text is empty.");
    if (!outputPath) throw new Error("News TTS output path is required.");

    await mkdir(path.dirname(outputPath), { recursive: true });

    await run(this.command, [
      "-v",
      this.voice,
      "-s",
      String(this.speed),
      "-w",
      outputPath,
      clean,
    ]);

    return {
      provider: this.name,
      voice: this.voice,
      speed: this.speed,
      outputPath,
    };
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(
          new Error(
            "espeak-ng is not installed or ESPEAK_NG_PATH is invalid. Configure a News TTS provider before rendering narration.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() || `espeak-ng failed with code ${code ?? "?"}.`,
        ),
      );
    });
  });
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
}
