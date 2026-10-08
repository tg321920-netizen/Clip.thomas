import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export async function runMedia(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, options.timeoutMs || 15 * 60 * 1000);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", c => { stdout = (stdout + c).slice(-2_000_000); options.onStdout?.(c); });
    child.stderr.on("data", c => { stderr = (stderr + c).slice(-2_000_000); });
    child.on("error", e => { clearTimeout(timer); reject(e); });
    child.on("close", code => { clearTimeout(timer); if (code === 0 && !timedOut) resolve({ stdout, stderr }); else reject(new Error(timedOut ? "El procesamiento excedió su tiempo máximo." : stderr.trim() || `Proceso multimedia falló (${code}).`)); });
  });
}

export async function probeMediaFile(filename) {
  const { stdout } = await runMedia(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-show_format", "-show_streams", "-of", "json", filename], { timeoutMs: 60_000 });
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find(s => s.codec_type === "video"), audio = parsed.streams?.find(s => s.codec_type === "audio");
  return { parsed, video, audio, duration: Number(parsed.format?.duration || video?.duration || 0) };
}

/** Validate the actual container and decode it before a result can become READY. */
export async function validateMp4(filename, options = {}) {
  const info = await stat(filename);
  if (!info.isFile() || info.size <= 0) throw new Error("El MP4 no existe o está vacío.");
  const { video, audio, duration, parsed } = await probeMediaFile(filename);
  if (!video?.width || !video?.height || !Number.isFinite(duration) || duration <= 0) throw new Error("El MP4 no tiene una pista de video y duración válidas.");
  if (options.requireAudio && !audio) throw new Error("El MP4 no contiene el audio solicitado.");
  if (video.codec_name !== "h264" || video.pix_fmt !== "yuv420p" || (audio && audio.codec_name !== "aac")) throw new Error("El MP4 no usa H.264, yuv420p y AAC compatibles con Android.");
  if (!String(parsed.format?.format_name).includes("mp4")) throw new Error("El resultado no es un contenedor MP4.");
  if (options.width && (video.width !== options.width || video.height !== options.height)) throw new Error("El MP4 tiene una resolución incorrecta.");
  if (options.duration && Math.abs(duration - options.duration) > Math.max(0.4, options.duration * 0.025)) throw new Error(`Render incompleto: ${duration}s, esperado ${options.duration}s.`);
  const videoDuration = Number(video.duration), audioDuration = Number(audio?.duration);
  if (audio && Number.isFinite(videoDuration) && Number.isFinite(audioDuration) && Math.abs(videoDuration - audioDuration) > 0.4) throw new Error("Las pistas de audio y video tienen duraciones incompatibles.");
  // Full decode catches truncated/corrupt payloads which ffprobe alone may accept.
  await runMedia(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-xerror", "-i", filename, "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"]);
  const scan = await runMedia(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-hide_banner", "-v", "info", "-i", filename, "-an", "-vf", "blackdetect=d=0.5:pix_th=0.04:pic_th=0.98", "-f", "null", "-"]);
  const blackIntervals = [...scan.stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)/g)].map(m => ({ start: Number(m[1]), end: Number(m[2]), duration: Number(m[3]) }));
  const blackSeconds = blackIntervals.reduce((n, item) => n + item.duration, 0);
  // Intentional dark scenes are project data. Partial dark intervals remain evidence to review.
  if (blackSeconds >= duration * 0.95 && options.allowDarkVideo !== true) throw new Error("El render está prácticamente negro. Revisa los recursos visuales antes de exportar.");
  return { valid: true, checkedAt: new Date().toISOString(), sizeBytes: info.size,
    duration, width: video.width, height: video.height, videoCodec: video.codec_name,
    audioCodec: audio?.codec_name || null, pixelFormat: video.pix_fmt,
    frameRate: video.avg_frame_rate, fullDecode: true, blackIntervals,
    warnings: blackSeconds > 0 ? ["Se detectaron intervalos oscuros; revisar contra las escenas intencionales."] : [],
    synchronization: "TRACK_DURATIONS_CHECKED", subtitleValidation: options.subtitleValidation || "NOT_REQUESTED" };
}
