import { mkdir, stat, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { buildSpeechZoomFilter } from "../reframe/AutoReframeService.mjs";
import { validateMp4, probeMediaFile } from "../media-processing/MediaValidationService.mjs";
import { buildAssDocument } from "../subtitles/SubtitleService.mjs";

const QUALITY = {
  FAST: { preset: "ultrafast", crf: "28" },
  BALANCED: { preset: "medium", crf: "23" },
  HIGH: { preset: "slow", crf: "20" },
};

export class RenderService {
  constructor(options = {}) { this.width = options.width || 1080; this.height = options.height || 1920; }
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
    const temporaryPath = path.join(outputDir, "render.partial.mp4");

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
    const postFilters = ["fps=30", "setpts=PTS-STARTPTS"];
    if (clip?.edit?.motionIntensity) {
      postFilters.push(buildSafeMotionFilter(clip.edit.motionIntensity, this.width, this.height));
    }
    let subtitlesBurned = false;
    let autoReframeApplied = false;
    if(clip?.edit?.subtitlesEnabled&&(!clip?.subtitles?.enabled||!clip.subtitles.cues?.length))throw new Error("Se solicitaron subtítulos, pero no existen tiempos y textos válidos para este clip.");

    if (
      clip?.edit?.autoReframeEnabled &&
      clip?.autoReframe?.enabled
    ) {
      const reframeFilter = buildSpeechZoomFilter(
        clip.autoReframe,
        project?.source?.fps,
      );

      if (reframeFilter) {
        postFilters.push(reframeFilter);
        autoReframeApplied = true;
      }
    }

    if (
      clip?.edit?.subtitlesEnabled &&
      clip?.subtitles?.enabled &&
      Array.isArray(clip?.subtitles?.cues) &&
      clip.subtitles.cues.length > 0
    ) {
      const assPath = path.join(outputDir, "subtitles.ass");
      await writeFile(assPath, buildAssDocument(clip.subtitles), "utf8");
      postFilters.push(`ass='${escapeFilterPath(assPath)}'`);
      subtitlesBurned = true;
    }

    const videoPlan = buildRenderVideoPlan(
      clip?.edit?.framingMode || "FIT",
      postFilters,
      this.width,
      this.height,
    );

    const args = [
      "-v",
      "error",
      "-y",
      "-filter_threads", "1",
      "-filter_complex_threads", "1",
      "-threads", "2",
      "-ss",
      startTime.toFixed(3),
      "-i",
      sourcePath,
      "-t",
      duration.toFixed(3),
      ...videoPlan.args,
      "-c:v",
      "libx264",
      "-preset",
      quality.preset,
      "-crf",
      quality.crf,
      "-threads", "2",
      "-r", "30",
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
      temporaryPath,
    ];

    await runFfmpeg(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      args,
      duration,
      onProgress,
    );

    const requireAudio = project.source.hasAudio ?? Boolean((await probeMediaFile(sourcePath)).audio);
    const validation = await validateMp4(temporaryPath, { requireAudio, duration, width: this.width, height: this.height, allowDarkVideo: project.allowDarkVideo, subtitleValidation: subtitlesBurned ? "ASS_BURNED_NOT_VISUALLY_VERIFIED" : "NOT_REQUESTED" });
    await rename(temporaryPath, outputPath);
    const probe = await probeVideo(outputPath);
    if (probe.width !== this.width || probe.height !== this.height) {
      throw new Error(
        `Rendered clip has unexpected resolution ${probe.width}x${probe.height}.`,
      );
    }

    const outputStat = await stat(outputPath);

    return {
      validation,
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
      autoReframeApplied,
    };
  }
}

export function buildSafeMotionFilter(intensity,width,height) {
  const amplitude = { GENTLE:0, NORMAL:0.015, DYNAMIC:0.03 }[intensity];
  if (amplitude === undefined) throw new Error("Invalid motion intensity.");
  if (amplitude === 0) return "null";
  const factor = `${1-amplitude}+${amplitude}*cos(2*PI*t/18)`;
  return `scale=w='trunc(iw*(${factor})/2)*2':h='trunc(ih*(${factor})/2)*2':eval=frame,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:eval=frame,setsar=1`;
}

export function buildRenderVideoPlan(mode = "FILL", postFilters = [], width = 1080, height = 1920) {
  assertResolution(width, height);
  const normalizedPostFilters = Array.isArray(postFilters)
    ? postFilters.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (mode === "CONVERSATION") {
    const graph = [
      "[0:v]split=2[bg][fg]",
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28[bgv]`,
      `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgv]`,
      "[bgv][fgv]overlay=(W-w)/2:(H-h)/2,setsar=1[basev]",
      `[basev]${normalizedPostFilters.length ? normalizedPostFilters.join(",") : "null"}[vout]`,
    ].join(";");

    return {
      mode: "complex",
      filter: graph,
      args: [
        "-filter_complex",
        graph,
        "-map",
        "[vout]",
        "-map",
        "0:a?",
      ],
    };
  }

  const base = buildVideoFilter(mode, width, height);
  const filter = [base, ...normalizedPostFilters].join(",");
  return {
    mode: "simple",
    filter,
    args: [
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      filter,
    ],
  };
}

export function buildVideoFilter(mode = "FILL", width = 1080, height = 1920) {
  assertResolution(width, height);
  if (mode === "CONVERSATION") {
    throw new Error(
      "CONVERSATION framing requires buildRenderVideoPlan() and FFmpeg -filter_complex.",
    );
  }

  if (mode === "FIT") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      "setsar=1",
    ].join(",");
  }

  if (mode !== "FILL") {
    throw new Error("Unsupported framing mode.");
  }

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    "setsar=1",
  ].join(",");
}

function assertResolution(width, height) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 144 && n <= 3840 && n % 2 === 0)) {
    throw new Error("Invalid output resolution.");
  }
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
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, 15 * 60 * 1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBuffer = (stdoutBuffer + chunk).slice(-2_000_000);
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
            onProgress(
              Math.min(
                99,
                Math.max(0, Math.round((seconds / duration) * 100)),
              ),
            );
          }
        }

        if (key === "progress" && value === "end") {
          onProgress(100);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2_000_000);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (error?.code === "ENOENT") {
        reject(new Error("FFmpeg is not installed or FFMPEG_PATH is invalid."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        onProgress(100);
        resolve();
        return;
      }

      reject(
        new Error(
          timedOut ? "El render superó el límite de 15 minutos. Se conservan los recursos y el archivo parcial para diagnóstico." : stderr.trim() || `FFmpeg render failed with code ${code ?? "?"}.`,
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
      else {
        reject(
          new Error(
            stderr.trim() || `Process failed with code ${code ?? "?"}.`,
          ),
        );
      }
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

