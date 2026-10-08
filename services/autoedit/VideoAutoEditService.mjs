import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { runMedia, probeMediaFile, validateMp4 } from "../media-processing/MediaValidationService.mjs";
import { RenderService, buildVideoFilter } from "../clip/RenderService.mjs";
import { buildSubtitleTrack } from "../subtitles/SubtitleService.mjs";
import { transcribeProject } from "../transcription/TranscriptionService.mjs";
import { WaitingResourceError } from "../owned-content/SceneStoryService.mjs";

export function buildKeepRanges(duration, silences, intensity = "NORMAL", speech = []) {
  const minimum = { GENTLE: 2, NORMAL: 1.3, DYNAMIC: 0.8 }[intensity];
  if (!minimum || !(duration > 0)) throw new Error("Intensidad o duración inválida.");
  const padding = intensity === "DYNAMIC" ? 0.25 : 0.35;
  const cuts = silences.map(s => ({ start: Math.max(0, s.start + padding), end: Math.min(duration, s.end - padding) }))
    .filter(c => c.end - c.start >= minimum - 2 * padding && !speech.some(s => s.startTime < c.end + 0.1 && s.endTime > c.start - 0.1))
    .sort((a,b) => a.start - b.start);
  let cursor = 0; const ranges = [];
  for (const cut of cuts) { if (cut.start > cursor + 0.1) ranges.push({ start: cursor, end: cut.start }); cursor = Math.max(cursor, cut.end); }
  if (duration > cursor + 0.1) ranges.push({ start: cursor, end: duration });
  return ranges.length ? ranges : [{ start: 0, end: duration }];
}

export function remapTranscript(transcript, ranges) {
  let offset = 0; const segments = [];
  for (const range of ranges) {
    for (const source of transcript?.segments || []) {
      if (source.endTime <= range.start || source.startTime >= range.end) continue;
      const words = source.words?.filter(w => w.startTime >= range.start && w.endTime <= range.end).map(w => ({ ...w, startTime: w.startTime - range.start + offset, endTime: w.endTime - range.start + offset }));
      segments.push({ ...source, id: `edit-segment-${segments.length + 1}`, startTime: Math.max(source.startTime, range.start) - range.start + offset, endTime: Math.min(source.endTime, range.end) - range.start + offset, ...(words?.length ? { words, text: words.map(w => w.text).join(" ") } : {}) });
    }
    offset += range.end - range.start;
  }
  return { ...transcript, id: randomUUID(), status: "COMPLETED", durationSeconds: offset, segments, text: segments.map(s => s.text).join(" ") };
}

export class VideoAutoEditService {
  constructor(options = {}) { this.width = options.width || Number(process.env.CLIPFORGE_MEDIA_WIDTH || 1080); this.height = options.height || Number(process.env.CLIPFORGE_MEDIA_HEIGHT || 1920); }
  async render(outputProjectId, input, onStage = async () => {}) {
    let original = await loadProjectFile(input.projectId);
    if (!original) throw new Error("El video original no existe.");
    const sourcePath = resolveStoragePath(original.source.relativePath), probe = await probeMediaFile(sourcePath);
    if (!probe.video || probe.duration > 6 * 3600) throw new Error("El video no es válido o supera seis horas.");
    const intensity = input.intensity || "NORMAL", subtitles = input.subtitles !== false;
    await onStage("PROCESSING", "ANALYSIS", 0);
    let transcript = original.transcript;
    if (subtitles && probe.audio && transcript?.status !== "COMPLETED") {
      try {
        await transcribeProject(input.projectId, { onProgress: async p => onStage("PROCESSING", "TRANSCRIBING", Math.round(p * 0.2)) });
        original = await loadProjectFile(input.projectId); transcript = original.transcript;
      } catch (error) { if (/not installed|ENOENT|MODEL_PATH|required|not found/i.test(error.message)) throw new WaitingResourceError("Whisper no está disponible para generar subtítulos reales. Configura Whisper en el worker o desactiva subtítulos para editar el video."); throw error; }
    }
    let silences = [];
    if (probe.audio) {
      const scan = await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-v", "info", "-i", sourcePath, "-vn", "-af", "silencedetect=noise=-38dB:d=0.8", "-f", "null", "-"]);
      let start = null;
      for (const match of scan.stderr.matchAll(/silence_(start|end): ([\d.]+)/g)) {
        if (match[1] === "start") start = Number(match[2]);
        else if (start !== null) { silences.push({ start, end: Number(match[2]) }); start = null; }
      }
      if (start !== null) silences.push({ start, end: probe.duration });
    }
    const sceneScan = await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-hide_banner", "-v", "info", "-i", sourcePath, "-an", "-vf", "scale=160:-2,select='gt(scene,0.35)',showinfo", "-f", "null", "-"]);
    const sceneChanges = [...sceneScan.stderr.matchAll(/pts_time:([\d.]+)/g)].map(m => Number(m[1]));
    const speech = (transcript?.segments || []).flatMap(s => s.words?.length ? s.words : [s]);
    const ranges = buildKeepRanges(probe.duration, silences, intensity, speech).map(r => ({ start: Math.ceil(r.start * 30) / 30, end: Math.floor(r.end * 30) / 30 })).filter(r => r.end > r.start);
    if (ranges.length > 120) throw new Error("El video requiere demasiados cortes; utiliza una intensidad más suave.");
    const directory = path.join(getStorageRoot(), "auto-videos", outputProjectId); await mkdir(directory, { recursive: true });
    const parts = [];
    for (let i = 0; i < ranges.length; i++) {
      const range = ranges[i], filename = path.join(directory, `part-${i}.mp4`);
      const args = ["-v", "error", "-y", "-filter_threads", "1", "-ss", String(range.start), "-i", sourcePath, "-t", String(range.end - range.start), "-map", "0:v:0", "-map", "0:a:0?", "-vf", `${buildVideoFilter("FIT", this.width, this.height)},fps=30,setpts=PTS-STARTPTS`, "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "aac", "-ar", "48000"];
      if (probe.audio) args.push("-af", "aresample=async=1:first_pts=0");
      args.push(filename); await runMedia(process.env.FFMPEG_PATH || "ffmpeg", args); parts.push(filename);
      await onStage("PROCESSING", "CUTTING", 20 + Math.round((i + 1) / ranges.length * 50));
    }
    const concat = path.join(directory, "concat.txt"); await writeFile(concat, parts.map(p => `file '${path.basename(p)}'`).join("\n"));
    const cleanPath = path.join(directory, "edited-clean.mp4");
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "1", "-i", concat, "-c", "copy", "-movflags", "+faststart", cleanPath]);
    const cleanProbe = await probeMediaFile(cleanPath);
    const duration = cleanProbe.duration, clipId = randomUUID(), now = new Date().toISOString();
    const trackTranscript = transcript?.status === "COMPLETED" ? remapTranscript(transcript, ranges) : undefined;
    const clip = { id: clipId, projectId: outputProjectId, candidateId: "full-edit", startTime: 0, endTime: duration, duration, status: "PROCESSING", edit: { framingMode: "FIT", motionIntensity:intensity, subtitlesEnabled: subtitles && Boolean(trackTranscript), subtitleStyle: "CLEAN", quality: "FAST" }, render: null, error: null, createdAt: now, updatedAt: now };
    if (trackTranscript && subtitles) clip.subtitles = buildSubtitleTrack({ transcript: trackTranscript, clip, style: "CLEAN" });
    const source = { ...original.source, projectId: outputProjectId, videoId: randomUUID(), originalName: `editado-${original.source.originalName}`, storedName: "edited-clean.mp4", relativePath: path.posix.join("auto-videos", outputProjectId, "edited-clean.mp4"), durationSeconds: duration, width: this.width, height: this.height, hasAudio: Boolean(probe.audio), codec: "h264", fps: 30, container: "mp4", aspectRatio: "9:16", sourceUrl: `/api/projects/${outputProjectId}/source`, posterUrl: `/api/projects/${outputProjectId}/poster` };
    const project = { id: outputProjectId, createdAt: now, source, clips: [clip], transcript: trackTranscript, autoEditEvidence: { originalProjectId: input.projectId, originalDuration: probe.duration, ranges, silences, sceneChanges, intensity, removedSeconds: probe.duration - ranges.reduce((n,r) => n + r.end - r.start, 0), framing: "SAFE_FIT_NO_SPEAKER_DETECTION" } };
    await onStage("PROCESSING", "SUBTITLES", 75);
    clip.render = await new RenderService({ width: this.width, height: this.height }).renderClip({ project, clip });
    await onStage("VALIDATING", "MEDIA_VALIDATION", 95);
    const validation = await validateMp4(resolveStoragePath(clip.render.relativePath), { requireAudio: Boolean(probe.audio), duration, width: this.width, height: this.height });
    clip.status = "READY"; await replaceProjectFile(outputProjectId, project);
    const posters = path.join(getStorageRoot(), "uploads", outputProjectId); await mkdir(posters, { recursive: true });
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", cleanPath, "-frames:v", "1", path.join(posters, "poster.jpg")]);
    return { projectId: outputProjectId, clipId, relativePath: clip.render.relativePath, sourceUrl: clip.render.sourceUrl, downloadUrl: `${clip.render.sourceUrl}?download=1`, validation, cuts: project.autoEditEvidence, title: source.originalName };
  }
}
