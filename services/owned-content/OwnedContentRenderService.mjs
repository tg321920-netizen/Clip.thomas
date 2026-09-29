import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { replaceProjectFile } from "../../lib/project-files.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { NewsRenderService } from "../news/NewsRenderService.mjs";
import { ContentCostService } from "./ContentCostService.mjs";

export class OwnedContentRenderService {
  constructor(options = {}) {
    this.costs = options.costs || new ContentCostService();
    this.newsRendererFactory = options.newsRendererFactory || ((audioPath) => new NewsRenderService({ ttsProvider: new PreparedAudioProvider(audioPath) }));
  }

  async render(input = {}) {
    const projectId = String(input.projectId || "").trim();
    const channelId = String(input.channelId || "").trim();
    const script = input.script;
    const audio = input.audio;
    const visualPlan = input.visualPlan;
    if (!projectId || !channelId || !script?.narration || !audio?.relativePath || !visualPlan?.posterRelativePath) {
      throw new Error("Owned-content render requires project, script, audio and visual plan.");
    }

    const audioPath = resolveStoragePath(audio.relativePath);
    const posterPath = resolveStoragePath(visualPlan.posterRelativePath);
    const newsRenderer = this.newsRendererFactory(audioPath);
    const brief = {
      narration: script.narration,
      headline: script.title,
      summary: sectionText(script, "WHAT_HAPPENED") || script.hook,
      category: input.category || "GENERAL",
      template: input.template || templateFor(input.category),
    };

    const base = await newsRenderer.render({ project: { id: projectId }, brief, onProgress: input.onProgress || (() => undefined) });
    const clipId = randomUUID();
    const outputDir = path.join(getStorageRoot(), "clips", projectId);
    const outputPath = path.join(outputDir, `${clipId}.mp4`);
    const assPath = path.join(getStorageRoot(), "owned-content", "captions", projectId, `${clipId}.ass`);
    await mkdir(outputDir, { recursive: true });
    await mkdir(path.dirname(assPath), { recursive: true });
    await writeFile(assPath, buildCaptionAss(audio.subtitleCues || [], input.brand, audio.durationSeconds, input.editTemplate?.subtitleStyle), "utf8");
    await burnCaptions(resolveStoragePath(base.relativePath), assPath, outputPath);
    const probe = await probeVideo(outputPath);
    const outputStat = await stat(outputPath);
    const now = new Date().toISOString();
    const relativePath = path.posix.join("clips", projectId, `${clipId}.mp4`);
    const sourceUrl = `/api/projects/${projectId}/clips/${clipId}/source`;
    const posterUrl = `/api/projects/${projectId}/poster`;

    const clip = {
      id: clipId,
      projectId,
      candidateId: "owned-content",
      startTime: 0,
      endTime: probe.duration,
      duration: probe.duration,
      status: "READY",
      edit: {
        framingMode: input.editTemplate?.framingMode || "FILL",
        subtitlesEnabled: true,
        subtitleStyle: input.editTemplate?.subtitleStyle || "CLEAN",
        quality: input.editTemplate?.quality || "BALANCED",
      },
      subtitles: {
        enabled: true,
        style: input.editTemplate?.subtitleStyle || "CLEAN",
        sourceTranscriptId: "owned-narration",
        cues: audio.subtitleCues || [],
        generatedAt: now,
        updatedAt: now,
      },
      autoEdit: null,
      autoReframe: null,
      render: {
        relativePath,
        sourceUrl,
        width: probe.width,
        height: probe.height,
        codec: probe.codec || "h264",
        container: "mp4",
        sizeBytes: outputStat.size,
        subtitlesBurned: true,
        autoReframeApplied: false,
      },
      createdAt: now,
      updatedAt: now,
      error: null,
    };

    const project = {
      id: projectId,
      createdAt: now,
      source: {
        projectId,
        originalName: `owned-content-${input.lineKey || "story"}.mp4`,
        storedName: `${clipId}.mp4`,
        sizeBytes: outputStat.size,
        durationSeconds: probe.duration,
        width: probe.width,
        height: probe.height,
        fps: probe.fps || 30,
        codec: probe.codec || "h264",
        container: "mp4",
        aspectRatio: "9:16",
        posterUrl,
        sourceUrl,
        relativePath,
      },
      clips: [clip],
      ownedContent: {
        channelId,
        lineKey: input.lineKey || null,
        researchId: input.researchId || null,
        scriptId: script.id,
        format: script.format,
        language: script.language,
        voiceProfile: audio.voiceProfile,
        visualAssetIds: visualPlan.assetIds || [],
        rightsReady: visualPlan.rightsReady === true,
      },
    };
    await replaceProjectFile(projectId, project);
    await this.costs.record({ channelId, contentId: projectId, category: "PROCESSING", provider: "local-ffmpeg", operation: "owned-content-render", amountUsd: 0, note: "Rendered locally using existing ClipForge News/FFmpeg pipeline." });

    return { projectId, clipId, clip, project, baseRender: base };
  }
}

class PreparedAudioProvider {
  constructor(sourcePath) { this.sourcePath = sourcePath; this.name = "prepared-audio"; }
  async synthesize({ outputPath }) { await mkdir(path.dirname(outputPath), { recursive: true }); await copyFile(this.sourcePath, outputPath); return { provider: this.name, outputPath }; }
}

function buildCaptionAss(cues, brand, durationSeconds, style) {
  const brandName = escapeAss(brand?.name || "");
  const cta = escapeAss(brand?.preferredCta || "");
  const captionSize = String(style || "CLEAN").toUpperCase() === "KARAOKE" ? 58 : String(style || "CLEAN").toUpperCase() === "VIRAL" ? 54 : 48;
  const lines = [
    "[Script Info]", "ScriptType: v4.00+", "PlayResX: 1080", "PlayResY: 1920", "WrapStyle: 2", "ScaledBorderAndShadow: yes", "",
    "[V4+ Styles]",
    "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding",
    `Style: Caption,Arial,${captionSize},&H00FFFFFF,&H0000FFFF,&H00101010,&HA0000000,-1,0,0,0,100,100,0,0,3,3,0,2,70,70,180,1`,
    "Style: Brand,Arial,30,&H00FFFFFF,&H000000FF,&H00101010,&H70000000,-1,0,0,0,100,100,0,0,3,2,0,9,40,40,40,1",
    "Style: CTA,Arial,34,&H00FFFFFF,&H000000FF,&H00101010,&H80000000,-1,0,0,0,100,100,0,0,3,2,0,2,70,70,70,1",
    "", "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text",
  ];
  if (brandName) lines.push(`Dialogue: 0,0:00:00.00,${assTime(durationSeconds)},Brand,,0,0,0,,${brandName}`);
  if (cta) lines.push(`Dialogue: 0,${assTime(Math.max(0, durationSeconds - Math.min(5, durationSeconds)))},${assTime(durationSeconds)},CTA,,0,0,0,,${cta}`);
  for (const cue of cues) {
    if (!(Number(cue.endTime) > Number(cue.startTime))) continue;
    lines.push(`Dialogue: 1,${assTime(cue.startTime)},${assTime(cue.endTime)},Caption,,0,0,0,,${wrapCaption(cue.text)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function burnCaptions(inputPath, assPath, outputPath) {
  const filter = `ass='${escapeFilterPath(assPath)}'`;
  return run(process.env.FFMPEG_PATH?.trim() || "ffmpeg", ["-v", "error", "-y", "-i", inputPath, "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "23", "-pix_fmt", "yuv420p", "-c:a", "copy", "-movflags", "+faststart", outputPath]);
}
async function probeVideo(filePath) {
  const output = await run(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath], true);
  const parsed = JSON.parse(output); const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const fpsParts = String(video?.avg_frame_rate || "30/1").split("/").map(Number); const fps = fpsParts[1] ? fpsParts[0] / fpsParts[1] : fpsParts[0];
  return { width: Number(video?.width || 0), height: Number(video?.height || 0), duration: Number(parsed.format?.duration || 0), codec: video?.codec_name || null, fps: Number.isFinite(fps) ? fps : 30 };
}
function run(command, args, capture = false) { return new Promise((resolve, reject) => { const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let stdout = "", stderr = ""; child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (c) => { stdout += c; }); child.stderr.on("data", (c) => { stderr += c; }); child.on("error", (error) => reject(error?.code === "ENOENT" ? new Error(`${command} is not installed or configured correctly.`) : error)); child.on("close", (code) => code === 0 ? resolve(capture ? stdout : undefined) : reject(new Error(stderr.trim() || `${command} failed with code ${code ?? "?"}.`))); }); }
function templateFor(category) { const value = String(category || "").toUpperCase(); return ["BREAKING", "SPORTS", "ECONOMY", "TECH"].includes(value) ? value : "CLEAN"; }
function sectionText(script, key) { return script.sections?.find((item) => item.key === key)?.text || ""; }
function wrapCaption(value) { const words = String(value || "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean); const lines = []; let current = ""; for (const word of words) { const next = current ? `${current} ${word}` : word; if (next.length <= 34) current = next; else { if (current) lines.push(current); current = word; } if (lines.length >= 2) break; } if (current && lines.length < 3) lines.push(current); return lines.slice(0, 3).map(escapeAss).join("\\N"); }
function escapeAss(value) { return String(value || "").replaceAll("\\", "∖").replaceAll("{", "(").replaceAll("}", ")").replace(/\r?\n/g, "\\N").trim(); }
function escapeFilterPath(value) { return String(value).replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'").replaceAll(",", "\\,").replaceAll("[", "\\[").replaceAll("]", "\\]"); }
function assTime(seconds) { const csTotal = Math.max(0, Math.round(Number(seconds || 0) * 100)); const hours = Math.floor(csTotal / 360000); const minutes = Math.floor((csTotal % 360000) / 6000); const secs = Math.floor((csTotal % 6000) / 100); const cs = csTotal % 100; return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(cs).padStart(2, "0")}`; }
