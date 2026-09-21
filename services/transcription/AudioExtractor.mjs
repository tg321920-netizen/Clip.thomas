import { mkdir } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

export async function extractWhisperAudio(inputPath, outputPath) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const command = process.env.FFMPEG_PATH?.trim() || "ffmpeg";

  await runProcess(command, [
    "-v", "error", "-y", "-i", inputPath,
    "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", outputPath,
  ]);
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
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error("FFmpeg is not available for audio extraction."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg audio extraction failed with code ${code ?? "?"}.`));
    });
  });
}
