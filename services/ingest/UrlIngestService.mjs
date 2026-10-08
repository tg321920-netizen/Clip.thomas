import { spawn } from "node:child_process";
import {
  mkdir,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { MAX_UPLOAD_BYTES } from "../../lib/upload-policy.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { hashFile } from "./ResumableUploadStore.mjs";
import { parsePublicSourceUrl } from "../../lib/public-source-url.mjs";

export async function ingestUrlJob(job, options = {}) {
  const projectId = job.projectId || job.id;
  const mode = String(job?.source?.mode || "IMPORT").toUpperCase();
  const sourceUrl = mode === "UPLOAD" ? null : await parsePublicSourceUrl(job?.source?.url);
  const existing = mode === "UPLOAD" ? await loadProjectFile(projectId) : null;
  if (existing?.source && existing.ingest?.jobId === job.id) return { projectId, video: existing.source };
  const root = getStorageRoot();
  const uploadDir = path.join(root, "uploads", projectId);
  const posterPath = path.join(uploadDir, "poster.jpg");
  const onProgress = typeof options.onProgress === "function"
    ? options.onProgress
    : async () => {};

  await mkdir(uploadDir, { recursive: true });
  await onProgress(2, "VALIDATING");

  let mediaPath;
  if (mode === "UPLOAD") {
    mediaPath = resolveStoragePath(job.source.relativePath);
    const info = await stat(mediaPath);
    if (info.size !== job.source.size || await hashFile(mediaPath) !== job.source.sha256) {
      throw new Error("El archivo guardado no supera la comprobación de integridad.");
    }
  } else if (mode === "STREAM") {
    mediaPath = await captureSegmentedStream({
      url: sourceUrl.toString(),
      uploadDir,
      captureSeconds: Number(job.source.captureSeconds || 30),
      segmentSeconds: Number(job.source.segmentSeconds || 300),
      onProgress,
    });
  } else if (mode === "IMPORT") {
    mediaPath = await importRemoteVideo({
      url: sourceUrl.toString(),
      uploadDir,
      onProgress,
    });
  } else {
    throw new Error(`Unsupported ingest mode: ${mode}.`);
  }

  const fileStats = await stat(mediaPath);
  if (!fileStats.isFile() || fileStats.size <= 0) {
    throw new Error("La fuente terminó sin generar un archivo de video válido.");
  }
  if (fileStats.size > MAX_UPLOAD_BYTES) {
    throw new Error("El video supera el límite actual de 1 GB.");
  }

  await onProgress(94, "PROBING");
  const technical = await probeMedia(mediaPath);
  await createPoster(
    mediaPath,
    posterPath,
    Math.min(1, technical.durationSeconds / 2),
  );

  const storedName = path.basename(mediaPath);
  const videoId = randomUUID();
  const video = {
    projectId,
    videoId,
    originalName: mode === "UPLOAD" ? job.source.filename : makeOriginalName(sourceUrl, storedName, mode),
    storedName,
    sizeBytes: fileStats.size,
    posterUrl: `/api/projects/${projectId}/poster`,
    sourceUrl: `/api/projects/${projectId}/source`,
    ...(sourceUrl ? { originUrl: redactUrlForMetadata(sourceUrl) } : {}),
    ingestMode: mode,
    ...technical,
  };

  await onProgress(98, "FINALIZING");
  await replaceProjectFile(projectId, {
    id: projectId,
    createdAt: new Date().toISOString(),
    source: {
      ...video,
      relativePath: path.posix.join("uploads", projectId, storedName),
    },
    ingest: {
      jobId: job.id,
      mode,
      sourceHost: sourceUrl?.hostname || null,
      sha256: job.source.sha256 || null,
      completedAt: new Date().toISOString(),
    },
  });

  await cleanupIngestArtifacts(uploadDir, storedName);
  await onProgress(100, "COMPLETED");
  return { projectId, video };
}

export async function importRemoteVideo({ url, uploadDir, onProgress = async () => {} }) {
  await mkdir(uploadDir, { recursive: true });
  const ytdlp = process.env.YTDLP_PATH?.trim() || "yt-dlp";
  const template = path.join(uploadDir, "source.%(ext)s");

  try {
    await runProcess(
      ytdlp,
      [
        "--no-playlist",
        "--continue",
        "--newline",
        "--no-warnings",
        "--max-filesize",
        "1000M",
        "--merge-output-format",
        "mp4",
        "--remux-video",
        "mp4",
        "--progress-template",
        "download:%(progress._percent_str)s",
        "-o",
        template,
        url,
      ],
      {
        timeoutMs: normalizeTimeout(process.env.CLIPFORGE_URL_IMPORT_TIMEOUT_MS, 6 * 60 * 60 * 1000),
        onStdoutLine(line) {
          const match = /^download:\s*([0-9.]+)%/.exec(line.trim());
          if (match) {
            const percent = Number(match[1]);
            if (Number.isFinite(percent)) {
              void onProgress(Math.max(4, Math.min(88, Math.round(4 + percent * 0.84))), "DOWNLOADING");
            }
          }
        },
      },
    );
  } catch (error) {
    if (getErrorCode(error) !== "ENOENT") {
      if (/sign in to confirm|not a bot|confirm you(?:'|’)re not a bot/i.test(compactError(error))) {
        throw new Error("YouTube bloqueó la importación porque exige una verificación de acceso. ClipForge no puede completarla automáticamente. Sube un archivo propio o autorizado usando Subir video.");
      }
      throw new Error(
        `No se pudo importar esa URL. ${compactError(error)} ` +
          "Si la plataforma exige sesión, cookies o permisos privados, usa una fuente autorizada o sube el archivo.",
      );
    }

    // A direct MP4/HLS URL can still work without yt-dlp. Normal web pages
    // cannot be resolved by FFmpeg and return an explicit error below.
    await onProgress(8, "DOWNLOADING");
    try {
      await downloadDirectWithFfmpeg(url, path.join(uploadDir, "source.mp4"));
    } catch (fallbackError) {
      throw new Error(
        "yt-dlp no está disponible en el runtime y FFmpeg tampoco pudo leer la URL como video directo. " +
          compactError(fallbackError),
      );
    }
  }

  const mediaPath = await findDownloadedMedia(uploadDir);
  if (!mediaPath) {
    throw new Error("La URL terminó sin producir un archivo multimedia compatible.");
  }

  await onProgress(90, "DOWNLOADED");
  return mediaPath;
}

export async function captureSegmentedStream({
  url,
  uploadDir,
  captureSeconds,
  segmentSeconds = 300,
  onProgress = async () => {},
}) {
  const totalSeconds = Math.max(5, Math.min(24 * 60 * 60, Math.round(Number(captureSeconds) || 30)));
  const chunkSeconds = Math.max(30, Math.min(15 * 60, Math.round(Number(segmentSeconds) || 300)));
  const partsDir = path.join(uploadDir, ".stream-parts");
  await mkdir(partsDir, { recursive: true });

  const existing = await listStreamParts(partsDir);
  const approximateCaptured = Math.min(totalSeconds, existing.length * chunkSeconds);
  const remaining = Math.max(0, totalSeconds - approximateCaptured);

  if (remaining > 0) {
    const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
    const outputPattern = path.join(partsDir, "part-%06d.mp4");
    const args = [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto,rtmp,rtmps",
      "-i",
      url,
      "-t",
      String(remaining),
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c:v",
      "mpeg4",
      "-q:v",
      "5",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-f",
      "segment",
      "-segment_time",
      String(chunkSeconds),
      "-segment_start_number",
      String(existing.length),
      "-reset_timestamps",
      "1",
      "-progress",
      "pipe:1",
      "-nostats",
      outputPattern,
    ];

    await runProcess(ffmpeg, args, {
      timeoutMs: (remaining + 180) * 1000,
      onStdoutLine(line) {
        const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
        if (!match) return;
        const seconds = Number(match[1]) / 1_000_000;
        if (!Number.isFinite(seconds)) return;
        const totalProgressSeconds = approximateCaptured + seconds;
        const percent = 4 + (totalProgressSeconds / totalSeconds) * 84;
        void onProgress(Math.max(4, Math.min(88, Math.round(percent))), "CAPTURING_STREAM");
      },
    });
  }

  const parts = await listStreamParts(partsDir);
  if (parts.length === 0) {
    throw new Error("FFmpeg no pudo obtener ningún segmento del stream.");
  }

  await onProgress(90, "MERGING_SEGMENTS");
  const concatPath = path.join(partsDir, "concat.txt");
  await writeFile(
    concatPath,
    parts.map((name) => `file '${name}'`).join("\n") + "\n",
    "utf8",
  );

  const output = path.join(uploadDir, "source.mp4");
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await runProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      concatPath,
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ],
    { cwd: partsDir, timeoutMs: 30 * 60 * 1000 },
  );

  return output;
}

async function downloadDirectWithFfmpeg(url, output) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await runProcess(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-y",
      "-protocol_whitelist",
      "file,http,https,tcp,tls,crypto",
      "-i",
      url,
      "-map",
      "0:v:0?",
      "-map",
      "0:a:0?",
      "-c",
      "copy",
      "-movflags",
      "+faststart",
      output,
    ],
    { timeoutMs: normalizeTimeout(process.env.CLIPFORGE_URL_IMPORT_TIMEOUT_MS, 6 * 60 * 60 * 1000) },
  );
}

async function probeMedia(filePath) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const { stdout } = await runProcess(
    ffprobe,
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { timeoutMs: 2 * 60 * 1000 },
  );

  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("FFprobe devolvió metadatos inválidos para la URL importada.");
  }

  const video = parsed?.streams?.find((stream) => stream?.codec_type === "video");
  const duration = Number(parsed?.format?.duration ?? video?.duration ?? 0);
  if (!video?.width || !video?.height || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("El contenido importado no contiene una pista de video válida con duración conocida.");
  }

  return {
    durationSeconds: round(duration),
    width: Number(video.width),
    height: Number(video.height),
    fps: round(parseRate(video.avg_frame_rate || video.r_frame_rate)),
    codec: video.codec_name || "desconocido",
    container: parsed?.format?.format_name?.split(",")[0] || "desconocido",
    hasAudio: parsed?.streams?.some((stream) => stream.codec_type === "audio"),
    aspectRatio:
      normalizeAspectRatio(video.display_aspect_ratio) ||
      reduceRatio(Number(video.width), Number(video.height)),
  };
}

async function createPoster(input, output, seekSeconds) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await runProcess(
    ffmpeg,
    [
      "-v",
      "error",
      "-y",
      "-ss",
      Math.max(0, Number(seekSeconds) || 0).toFixed(3),
      "-i",
      input,
      "-frames:v",
      "1",
      "-q:v",
      "3",
      output,
    ],
    { timeoutMs: 2 * 60 * 1000 },
  );
}

async function findDownloadedMedia(uploadDir) {
  const names = await readdir(uploadDir);
  const preferred = names.find((name) => /^source\.mp4$/i.test(name));
  const compatible = names.find((name) => /^source\.(mp4|mov|webm)$/i.test(name));
  return preferred
    ? path.join(uploadDir, preferred)
    : compatible
      ? path.join(uploadDir, compatible)
      : null;
}

async function listStreamParts(partsDir) {
  const names = await readdir(partsDir).catch(() => []);
  return names.filter((name) => /^part-\d{6}\.mp4$/.test(name)).sort();
}

async function cleanupIngestArtifacts(uploadDir, storedName) {
  const entries = await readdir(uploadDir).catch(() => []);
  await Promise.all(
    entries
      .filter((name) => name !== storedName && name !== "poster.jpg")
      .filter((name) => name.endsWith(".part") || name === ".stream-parts")
      .map((name) => rm(path.join(uploadDir, name), { recursive: true, force: true })),
  );
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 2_000_000) stdout += chunk;
      emitLines(stdoutBuffer, chunk, options.onStdoutLine);
    });
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 64_000) stderr += chunk;
      emitLines(stderrBuffer, chunk, options.onStderrLine);
    });

    const timeoutMs = Number(options.timeoutMs || 0);
    const timer = timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          settled = true;
          child.kill("SIGKILL");
          reject(new Error("El proceso de ingesta excedió su tiempo máximo."));
        }, timeoutMs)
      : null;
    timer?.unref?.();

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(
        new Error(
          stderr.trim().slice(-4000) ||
            stdout.trim().slice(-4000) ||
            `Proceso de ingesta terminó con código ${code ?? "?"}.`,
        ),
      );
    });
  });
}

function emitLines(buffer, chunk, handler) {
  if (typeof handler !== "function") return;
  buffer.value += chunk;
  const lines = buffer.value.split(/\r?\n/);
  buffer.value = lines.pop() || "";
  for (const line of lines) handler(line);
}

function makeOriginalName(url, storedName, mode) {
  const base = url.pathname.split("/").filter(Boolean).pop();
  if (base && /\.(mp4|mov|webm)$/i.test(base)) return base.slice(0, 180);
  return `${mode === "STREAM" ? "stream" : "url"}-${url.hostname}-${Date.now()}${path.extname(storedName) || ".mp4"}`;
}

function redactUrlForMetadata(url) {
  return `${url.protocol}//${url.host}${url.pathname}`;
}

function compactError(error) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").trim().slice(-1200)
    : String(error).slice(-1200);
}

function normalizeTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(60_000, Math.min(24 * 60 * 60 * 1000, Math.round(number)))
    : fallback;
}

function parseRate(rate) {
  if (!rate) return 0;
  const [numerator, denominator] = String(rate).split("/").map(Number);
  if (!Number.isFinite(numerator)) return 0;
  return round(denominator ? numerator / denominator : numerator);
}

function normalizeAspectRatio(value) {
  if (!value || value === "0:1" || value === "N/A") return null;
  return value;
}

function reduceRatio(width, height) {
  const divisor = gcd(width, height);
  return `${width / divisor}:${height / divisor}`;
}

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}

function getErrorCode(error) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
