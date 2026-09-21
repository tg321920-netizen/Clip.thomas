import { spawn } from "node:child_process";
import type { ProbeMetadata } from "@/types/video";

type FfprobeStream = {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  display_aspect_ratio?: string;
  duration?: string;
};

type FfprobeOutput = {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
    format_name?: string;
  };
};

export class VideoProcessingError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "FFPROBE_NOT_FOUND"
      | "FFPROBE_FAILED"
      | "INVALID_MEDIA",
  ) {
    super(message);
    this.name = "VideoProcessingError";
  }
}

export class VideoProcessor {
  async probe(filePath: string): Promise<ProbeMetadata> {
    const executable = process.env.FFPROBE_PATH?.trim() || "ffprobe";

    let stdout: string;
    try {
      stdout = await runProcess(executable, [
        "-v",
        "error",
        "-print_format",
        "json",
        "-show_format",
        "-show_streams",
        filePath,
      ]);
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        throw new VideoProcessingError(
          "FFprobe no está instalado o FFPROBE_PATH no apunta a un binario válido.",
          "FFPROBE_NOT_FOUND",
        );
      }

      throw new VideoProcessingError(
        error instanceof Error ? error.message : "FFprobe no pudo analizar el archivo.",
        "FFPROBE_FAILED",
      );
    }

    let parsed: FfprobeOutput;
    try {
      parsed = JSON.parse(stdout) as FfprobeOutput;
    } catch {
      throw new VideoProcessingError(
        "FFprobe devolvió una respuesta inválida.",
        "FFPROBE_FAILED",
      );
    }

    const video = parsed.streams?.find((stream) => stream.codec_type === "video");
    if (!video?.width || !video.height) {
      throw new VideoProcessingError(
        "El archivo no contiene una pista de video válida.",
        "INVALID_MEDIA",
      );
    }

    const duration = Number(parsed.format?.duration ?? video.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new VideoProcessingError(
        "No se pudo determinar la duración real del video.",
        "INVALID_MEDIA",
      );
    }

    return {
      durationSeconds: round(duration, 3),
      width: video.width,
      height: video.height,
      fps: round(parseRate(video.avg_frame_rate || video.r_frame_rate), 3),
      codec: video.codec_name || "desconocido",
      container: parsed.format?.format_name?.split(",")[0] || "desconocido",
      aspectRatio:
        normalizeAspectRatio(video.display_aspect_ratio) ||
        reduceRatio(video.width, video.height),
    };
  }
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `FFprobe terminó con código ${code ?? "?"}.`));
    });
  });
}

function parseRate(rate?: string): number {
  if (!rate) return 0;
  const [numerator, denominator] = rate.split("/").map(Number);
  if (!Number.isFinite(numerator)) return 0;
  if (!denominator) return numerator;
  return numerator / denominator;
}

function normalizeAspectRatio(value?: string): string | null {
  if (!value || value === "0:1" || value === "N/A") return null;
  return value;
}

function reduceRatio(width: number, height: number): string {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) {
    [x, y] = [y, x % y];
  }
  return x || 1;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
