import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { normalizeWhisperResult } from "../../lib/transcript-normalizer.mjs";

export class WhisperCliProvider {
  constructor(options = {}) {
    this.command = options.command || process.env.WHISPER_COMMAND?.trim() || "whisper";
    this.model = options.model || process.env.WHISPER_MODEL?.trim() || "base";
    this.language = options.language ?? process.env.WHISPER_LANGUAGE?.trim() ?? "";
  }

  async transcribe(audioPath, outputDir) {
    await mkdir(outputDir, { recursive: true });

    const args = [
      audioPath,
      "--model", this.model,
      "--output_format", "json",
      "--output_dir", outputDir,
      "--word_timestamps", "True",
      "--verbose", "False",
    ];

    if (this.language) args.push("--language", this.language);

    await runWhisper(this.command, args);

    const outputPath = path.join(outputDir, `${path.parse(audioPath).name}.json`);

    let payload;
    try {
      payload = JSON.parse(await readFile(outputPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Whisper completed but its JSON output could not be read: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    const normalized = normalizeWhisperResult(payload);
    if (normalized.segments.length === 0) {
      throw new Error("Whisper returned no valid transcript segments.");
    }

    return { provider: "whisper-cli", model: this.model, ...normalized };
  }
}

function runWhisper(command, args) {
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
        reject(new Error("Whisper CLI is not installed or WHISPER_COMMAND is incorrect."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `Whisper failed with code ${code ?? "?"}.`));
    });
  });
}
