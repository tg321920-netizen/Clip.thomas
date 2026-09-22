import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { buildAssDocument } from "../subtitles/SubtitleService.mjs";

const QUALITY = {
  FAST: { preset: "ultrafast", crf: "28" },
  BALANCED: { preset: "medium", crf: "23" },
  HIGH: { preset: "slow", crf: "20" },
};

export class RenderService {
  async renderClip({
    project,
    clip,
    onProgress = () => undefined,
  }) {
    const sourcePath = resolveStoragePath(project?.source?.relativePath);
    const outputDir = path.join(
      getStorageRoot(),
      "clips",
      project.id,
      clip.id,
    );
    const outputPath = path.join(outputDir, "render.mp4");

    await mkdir(outputDir, { recursive: true });

    const duration = Number(clip.duration);
    const startTime = Number(clip.startTime);

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Clip duration is invalid.");
    }
    if (!Number.isFinite(startTime) || startTime < 0) {
      throw new Error("Clip startTime is invalid.");
    }

    const quality = QUALITY[clip?.edit?.quality] || QUALITY.BALANCED;
    let filter = buildVideoFilter(clip?.edit?.framingMode || "FILL");
    let subtitlesBurned = false;

    if (
      clip?.edit?.subtitlesEnabled &&
      clip?.subtitles?.enabled &&
      Array.isArray(clip?.subtitles?.cues) &&
      clip.subtitles.cues.length > 0
    ) {
      const assPath = path.join(outputDir, "subtitles.ass");
      await writeFile(assPath, buildAssDocument(clip.subtitles), "utf8");
      filter = `${filter},ass='${escapeFilterPath(assPath)}'`;
      subtitlesBurned = true;
    }

    const args = [
      "-v",
      "error",
      "-y",
      "-i",
      sourcePath,
      "-ss",
      startTime.toFixed(3),
      "-t",
      duration.toFixed(3),
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      quality.preset,
      "-crf",
      quality.crf,
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      outputPath,
    ];

    await runFfmpeg(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      args,
      duration,
      onProgress,
    );

    const probe = await probeVideo(outputPath);
    if (probe.width !== 1080 || probe.height !== 1920) {
      throw new Error(
        `Rendered clip has unexpected resolution ${probe.width}x${probe.height}.`,
      );
    }

    const outputStat = await stat(outputPath);

    return {
      relativePath: path.posix.join(
        "clips",
        project.id,
        clip.id,
        "render.mp4",
      ),
      sourceUrl: `/api/projects/${project.id}/clips/${clip.id}/source`,
      width: probe.width,
      height: probe.height,
      codec: probe.codec,
      container: probe.container,
      sizeBytes: outputStat.size,
      subtitlesBurned,
    };
  }
}

export function buildVideoFilter(mode = "FILL") {
  if (mode === "FIT") {
    return [
      "scale=1080:1920:force_original_aspect_ratio=decrease",
      "pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black",
      "setsar=1",
    ].join(",");
  }

  if (mode !== "FILL") {
    throw new Error("Unsupported framing mode.");
  }

  return [
    "scale=1080:1920:force_original_aspect_ratio=increase",
    "crop=1080:1920",
    "setsar=1",
  ].join(",");
}

function runFfmpeg(command, args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0) continue;

        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);

        if (key === "out_time") {
          const seconds = parseFfmpegTime(value);
          if (Number.isFinite(seconds)) {
            onProgress(Math.min(99, Math.max(0, Math.round((seconds / duration) * 100))));
          }
        }

        if (key === "progress" && value === "end") {
          onProgress(100);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", (error) => {
      if (error?.code === "ENOENT") {
        reject(new Error("FFmpeg is not installed or FFMPEG_PATH is invalid."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        onProgress(100);
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() || `FFmpeg render failed with code ${code ?? "?"}.`,
        ),
      );
    });
  });
}

function parseFfmpegTime(value) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(value).trim());
  if (!match) return Number.NaN;

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

async function probeVideo(filePath) {
  const stdout = await runProcess(
    process.env.FFPROBE_PATH?.trim() || "ffprobe",
    [
      "-v",
      "error",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      filePath,
    ],
  );

  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");

  if (!video?.width || !video?.height) {
    throw new Error("Rendered clip has no valid video stream.");
  }

  return {
    width: Number(video.width),
    height: Number(video.height),
    codec: video.codec_name || "unknown",
    container: parsed.format?.format_name?.split(",")[0] || "unknown",
  };
}

function runProcess(command, args) {
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

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `Process failed with code ${code ?? "?"}.`));
    });
  });
}


function escapeFilterPath(filePath) {
  return String(filePath)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}
