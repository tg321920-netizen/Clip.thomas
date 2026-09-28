import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function extractWhisperAudio(inputPath, outputPath, options = {}) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const command = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const startTime = finiteNonNegative(options.startTime);
  const duration = finitePositive(options.duration);
  const args = ["-v", "error", "-y"];

  // Seek before decoding so long sources do not need to be decoded from 0 for
  // every transcription chunk. Timestamps are restored by TranscriptionService.
  if (startTime !== null && startTime > 0) {
    args.push("-ss", String(startTime));
  }

  args.push("-i", inputPath);

  if (duration !== null) {
    args.push("-t", String(duration));
  }

  args.push(
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
    outputPath,
  );

  await runProcess(command, args);
}

function finiteNonNegative(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new Error("Audio extraction startTime must be a non-negative number.");
  }
  return number;
}

function finitePositive(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error("Audio extraction duration must be a positive number.");
  }
  return number;
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 16000) stderr += chunk;
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error("FFmpeg is not available for audio extraction."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(
        new Error(
          stderr.trim() ||
            `FFmpeg audio extraction failed with code ${code ?? "?"}.`,
        ),
      );
    });
  });
}
