import { spawn } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { EspeakNewsTtsProvider } from "./EspeakNewsTtsProvider.mjs";

export class NewsRenderService {
  constructor(options = {}) {
    this.ttsProvider = options.ttsProvider || new EspeakNewsTtsProvider(options.ttsOptions);
  }

  async render({ project, brief, onProgress = () => undefined }) {
    if (!project?.id) throw new Error("News render requires a project.");
    if (!brief?.narration) throw new Error("News render requires narration text.");

    const root = getStorageRoot();
    const outputDir = path.join(root, "news", project.id);
    const posterPath = path.join(root, "uploads", project.id, "poster.jpg");
    const narrationPath = path.join(outputDir, "narration.wav");
    const assPath = path.join(outputDir, "template.ass");
    const outputPath = path.join(outputDir, "render.mp4");

    await mkdir(outputDir, { recursive: true });

    await this.ttsProvider.synthesize({
      text: brief.narration,
      outputPath: narrationPath,
    });

    const durationSeconds = await probeDuration(narrationPath);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("News narration audio has invalid duration.");
    }

    await writeFile(
      assPath,
      buildNewsAssDocument(brief, durationSeconds),
      "utf8",
    );

    const filter = buildNewsVideoFilter(assPath);

    await runFfmpeg(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      [
        "-v",
        "error",
        "-y",
        "-loop",
        "1",
        "-framerate",
        "30",
        "-i",
        posterPath,
        "-i",
        narrationPath,
        "-filter_complex",
        filter,
        "-map",
        "[v]",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "160k",
        "-shortest",
        "-movflags",
        "+faststart",
        "-progress",
        "pipe:1",
        "-nostats",
        outputPath,
      ],
      durationSeconds,
      onProgress,
    );

    const probe = await probeVideo(outputPath);
    if (probe.width !== 1080 || probe.height !== 1920) {
      throw new Error(
        `News render has unexpected resolution ${probe.width}x${probe.height}.`,
      );
    }

    const outputStat = await stat(outputPath);

    return {
      relativePath: path.posix.join("news", project.id, "render.mp4"),
      sourceUrl: `/api/projects/${project.id}/news/source`,
      narrationRelativePath: path.posix.join(
        "news",
        project.id,
        "narration.wav",
      ),
      width: probe.width,
      height: probe.height,
      durationSeconds: probe.duration,
      sizeBytes: outputStat.size,
      ttsProvider: this.ttsProvider.name || "unknown",
      template: brief.template,
    };
  }
}

export function buildNewsVideoFilter(assPath) {
  const escapedAss = escapeFilterPath(assPath);

  return [
    "[0:v]split=2[bg][fg]",
    "[bg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,gblur=sigma=22[bg2]",
    "[fg]scale=960:920:force_original_aspect_ratio=decrease[fg2]",
    "[bg2][fg2]overlay=(W-w)/2:300[base]",
    `[base]ass='${escapedAss}',format=yuv420p[v]`,
  ].join(";");
}

export function buildNewsAssDocument(brief, durationSeconds) {
  const palette = templatePalette(brief?.template);
  const end = assTime(durationSeconds);
  const category = escapeAssText(String(brief?.category || "GENERAL"));
  const headline = wrapAssText(brief?.headline, 28, 3);
  const summary = wrapAssText(brief?.summary, 42, 4);

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "PlayResX: 1080",
    "PlayResY: 1920",
    "WrapStyle: 2",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Category,Arial,38,${palette.primary},&H000000FF,${palette.outline},${palette.back},-1,0,0,0,100,100,1,0,1,3,0,8,70,70,78,1`,
    `Style: Headline,Arial,72,${palette.primary},&H000000FF,${palette.outline},${palette.back},-1,0,0,0,100,100,0,0,1,5,1,8,70,70,145,1`,
    `Style: Summary,Arial,46,&H00FFFFFF,&H000000FF,&H00111111,&HA0000000,0,0,0,0,100,100,0,0,3,2,0,2,90,90,150,1`,
    "",
    "[Events]",
    "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
    `Dialogue: 0,0:00:00.00,${end},Category,,0,0,0,,${category}`,
    `Dialogue: 0,0:00:00.00,${end},Headline,,0,0,0,,${headline}`,
    `Dialogue: 0,0:00:00.00,${end},Summary,,0,0,0,,${summary}`,
    "",
  ].join("\n");
}

function templatePalette(template) {
  if (template === "BREAKING") {
    return {
      primary: "&H00FFFFFF",
      outline: "&H000000FF",
      back: "&H90000088",
    };
  }

  if (template === "TECH") {
    return {
      primary: "&H00FFF0B0",
      outline: "&H00604020",
      back: "&H90202020",
    };
  }

  if (template === "SPORTS") {
    return {
      primary: "&H00D8FFD8",
      outline: "&H00206020",
      back: "&H90202020",
    };
  }

  if (template === "ECONOMY") {
    return {
      primary: "&H00E6F4FF",
      outline: "&H00402010",
      back: "&H90202020",
    };
  }

  return {
    primary: "&H00FFFFFF",
    outline: "&H00151515",
    back: "&H90202020",
  };
}

function wrapAssText(value, maxChars, maxLines) {
  const words = String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);

  const lines = [];
  let current = "";

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxChars || !current) {
      current = next;
      continue;
    }

    lines.push(current);
    current = word;

    if (lines.length >= maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);

  const usedWords = lines.join(" ").split(" ").filter(Boolean).length;
  if (usedWords < words.length && lines.length > 0) {
    lines[lines.length - 1] = `${lines[lines.length - 1].replace(/…$/, "")}…`;
  }

  return lines.map(escapeAssText).join("\\N");
}

function escapeAssText(value) {
  return String(value || "")
    .replaceAll("\\", "∖")
    .replaceAll("{", "(")
    .replaceAll("}", ")")
    .replace(/\r?\n/g, "\\N")
    .trim();
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

function assTime(seconds) {
  const centiseconds = Math.max(0, Math.round(Number(seconds) * 100));
  const hours = Math.floor(centiseconds / 360000);
  const minutes = Math.floor((centiseconds % 360000) / 6000);
  const secs = Math.floor((centiseconds % 6000) / 100);
  const cs = centiseconds % 100;

  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function probeDuration(filePath) {
  return runProcess(process.env.FFPROBE_PATH?.trim() || "ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]).then((output) => Number(String(output).trim()));
}

async function probeVideo(filePath) {
  const output = await runProcess(
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

  const parsed = JSON.parse(output);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");

  return {
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    duration: Number(parsed.format?.duration || 0),
  };
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
            onProgress(
              Math.min(99, Math.max(0, Math.round((seconds / duration) * 100))),
            );
          }
        }

        if (key === "progress" && value === "end") onProgress(100);
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
          stderr.trim() || `FFmpeg news render failed with code ${code ?? "?"}.`,
        ),
      );
    });
  });
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

function parseFfmpegTime(value) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(value).trim());
  if (!match) return Number.NaN;

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}
