import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { normalizeWhisperResult } from "../../lib/transcript-normalizer.mjs";

export class WhisperCppProvider {
  constructor(options = {}) {
    this.command =
      options.command || process.env.WHISPER_CPP_COMMAND?.trim() || "whisper-cli";
    this.modelPath =
      options.modelPath || process.env.WHISPER_CPP_MODEL_PATH?.trim() || "";
    this.language =
      options.language ?? process.env.WHISPER_LANGUAGE?.trim() ?? "auto";
    this.threads = clampInteger(
      options.threads ?? process.env.WHISPER_CPP_THREADS ?? 1,
      1,
      4,
    );
  }

  async transcribe(audioPath, outputDir) {
    if (!this.modelPath) {
      throw new Error(
        "WHISPER_CPP_MODEL_PATH is required when WHISPER_PROVIDER=cpp.",
      );
    }

    await mkdir(outputDir, { recursive: true });

    const outputBase = path.join(
      outputDir,
      `${path.parse(audioPath).name}.whispercpp`,
    );
    const args = [
      "-m",
      this.modelPath,
      "-f",
      audioPath,
      "-ojf",
      "-of",
      outputBase,
      "-np",
      "-ng",
      "-t",
      String(this.threads),
    ];

    if (this.language) args.push("-l", this.language);

    await runWhisperCpp(this.command, args);

    let payload;
    try {
      payload = JSON.parse(await readFile(`${outputBase}.json`, "utf8"));
    } catch (error) {
      throw new Error(
        `whisper.cpp completed but its JSON output could not be read: ${
          error instanceof Error ? error.message : "unknown error"
        }`,
      );
    }

    const normalized = normalizeWhisperResult(convertWhisperCppPayload(payload));
    if (normalized.segments.length === 0) {
      throw new Error("whisper.cpp returned no valid transcript segments.");
    }

    return {
      provider: "whisper.cpp",
      model: path.basename(this.modelPath),
      ...normalized,
    };
  }
}

export function convertWhisperCppPayload(payload) {
  const rawSegments = Array.isArray(payload?.transcription)
    ? payload.transcription
    : [];

  const segments = rawSegments
    .map((segment) => {
      const startMs = Number(segment?.offsets?.from);
      const endMs = Number(segment?.offsets?.to);
      const text = String(segment?.text ?? "").trim();

      if (
        !Number.isFinite(startMs) ||
        !Number.isFinite(endMs) ||
        startMs < 0 ||
        endMs <= startMs ||
        text.length === 0
      ) {
        return null;
      }

      const words = Array.isArray(segment?.tokens)
        ? segment.tokens
            .map((token) => convertToken(token, startMs, endMs))
            .filter(Boolean)
        : [];

      return {
        start: startMs / 1000,
        end: endMs / 1000,
        text,
        ...(words.length > 0 ? { words } : {}),
      };
    })
    .filter(Boolean);

  const text = segments.map((segment) => segment.text).join(" ").trim();
  const language =
    cleanLanguage(payload?.result?.language) ||
    cleanLanguage(payload?.params?.language) ||
    null;

  return { text, language, segments };
}

function convertToken(token, segmentStartMs, segmentEndMs) {
  const startMs = Number(token?.offsets?.from);
  const endMs = Number(token?.offsets?.to);
  const text = String(token?.text ?? "").trim();

  if (
    !Number.isFinite(startMs) ||
    !Number.isFinite(endMs) ||
    startMs < segmentStartMs - 250 ||
    endMs > segmentEndMs + 250 ||
    endMs <= startMs ||
    !text ||
    /^<\|.*\|>$/.test(text)
  ) {
    return null;
  }

  const probability = Number(token?.p);
  return {
    start: startMs / 1000,
    end: endMs / 1000,
    word: text,
    ...(Number.isFinite(probability) ? { probability } : {}),
  };
}

function runWhisperCpp(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
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
            "whisper.cpp CLI is not installed or WHISPER_CPP_COMMAND is incorrect.",
          ),
        );
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) resolve();
      else {
        reject(
          new Error(
            stderr.trim() || `whisper.cpp failed with code ${code ?? "?"}.`,
          ),
        );
      }
    });
  });
}

function clampInteger(value, min, max) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function cleanLanguage(value) {
  const text = String(value || "").trim();
  if (!text || text.toLowerCase() === "auto") return null;
  return text;
}
