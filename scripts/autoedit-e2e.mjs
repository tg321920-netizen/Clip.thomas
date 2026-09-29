import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { analyzeProject } from "../services/analysis/ContentAnalysisService.mjs";
import { prepareAutoEdit } from "../services/autoedit/AutoEditService.mjs";
import { renderClip } from "../services/clip/ClipService.mjs";
import { resolveStoragePath } from "../lib/storage-paths.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-autoedit-e2e-"));
const storage = path.join(root, "storage");
const projectId = "3fe30df3-70ab-4c22-aa7c-8028b602d269";
const videoId = "4e48e69c-43fb-4fc4-bcf7-ce4bdb90cae3";
const uploadDir = path.join(storage, "uploads", projectId);
const projectsDir = path.join(storage, "projects");
const sourcePath = path.join(uploadDir, "source.mp4");
const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
process.env.CLIPFORGE_STORAGE_DIR = storage;

try {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });

  await run(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
    "-v", "error", "-y",
    "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=24",
    "-f", "lavfi", "-i", "sine=frequency=660:sample_rate=44100",
    "-t", "12",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    sourcePath,
  ]);

  const sourceStat = await stat(sourcePath);
  const sourceHashBefore = await hashFile(sourcePath);
  const completedAt = new Date().toISOString();
  const segments = [
    segment(0, 4, "Este video explica una idea clara para crear contenido corto y útil."),
    segment(4, 8, "Primero analizamos el mensaje y detectamos el momento más comprensible."),
    segment(8, 12, "Después editamos en vertical con subtítulos para que quede listo para publicar."),
  ];

  const project = {
    id: projectId,
    createdAt: completedAt,
    source: {
      projectId,
      videoId,
      originalName: "autoedit-e2e.mp4",
      storedName: "source.mp4",
      sizeBytes: sourceStat.size,
      durationSeconds: 12,
      width: 640,
      height: 360,
      fps: 24,
      codec: "h264",
      container: "mp4",
      aspectRatio: "16:9",
      posterUrl: "",
      sourceUrl: "",
      relativePath: path.posix.join("uploads", projectId, "source.mp4"),
    },
    transcript: {
      id: "transcript-autoedit-e2e",
      projectId,
      videoId,
      status: "COMPLETED",
      provider: "fixture",
      model: "fixture-v1",
      language: "es",
      text: segments.map((item) => item.text).join(" "),
      segments,
      sourceKey: "autoedit-e2e",
      audioRelativePath: null,
      createdAt: completedAt,
      startedAt: completedAt,
      completedAt,
      error: null,
    },
  };

  await writeFile(path.join(projectsDir, `${projectId}.json`), JSON.stringify(project, null, 2), "utf8");

  const analyzed = await analyzeProject(projectId, {
    providerName: "heuristic",
    minDuration: 5,
    maxDuration: 10,
    targetDuration: 8,
    maxCandidates: 1,
  });
  assert(analyzed.analysis.status === "COMPLETED", "Analysis did not complete");
  assert(analyzed.analysis.candidates.length === 1, "Analysis did not produce one candidate");

  const prepared = await prepareAutoEdit(projectId, {
    providerName: "heuristic",
    generateSubtitles: true,
    framingMode: "FILL",
    quality: "FAST",
    subtitleStyle: "KARAOKE",
  });
  assert(prepared.reused === false, "First AutoEdit should be new");
  assert(prepared.clip.status === "DRAFT", "AutoEdit clip should begin as DRAFT");
  assert(prepared.clip.autoEdit?.framingMode === "FILL", "AutoEdit framing override was not applied");
  assert(prepared.clip.autoEdit?.quality === "FAST", "AutoEdit quality override was not applied");
  assert(prepared.clip.autoEdit?.subtitleStyle === "KARAOKE", "AutoEdit subtitle override was not applied");
  assert(prepared.clip.subtitles?.enabled === true, "AutoEdit did not generate subtitles");
  assert(prepared.clip.subtitles?.style === "KARAOKE", "AutoEdit subtitle style was not persisted");

  const rendered = await renderClip(projectId, prepared.clip.id);
  assert(rendered.clip.status === "READY", "Rendered AutoEdit clip is not READY");
  assert(rendered.clip.render?.width === 1080, "Rendered width is not 1080");
  assert(rendered.clip.render?.height === 1920, "Rendered height is not 1920");
  assert(rendered.clip.render?.subtitlesBurned === true, "Rendered clip did not burn subtitles");

  const renderedPath = resolveStoragePath(rendered.clip.render.relativePath);
  const renderedStat = await stat(renderedPath);
  assert(renderedStat.size > 0, "Rendered MP4 is empty");
  const probe = await ffprobe(renderedPath);
  assert(probe.width === 1080 && probe.height === 1920, "ffprobe did not confirm 9:16 output");
  assert(probe.duration >= 5 && probe.duration <= 10.5, `Unexpected rendered duration: ${probe.duration}`);

  const sourceHashAfter = await hashFile(sourcePath);
  assert(sourceHashAfter === sourceHashBefore, "Source video changed during AutoEdit/render");

  const preparedAgain = await prepareAutoEdit(projectId, {
    providerName: "heuristic",
    generateSubtitles: true,
    framingMode: "FILL",
    quality: "FAST",
    subtitleStyle: "KARAOKE",
  });
  assert(preparedAgain.reused === true, "Second AutoEdit should reuse the existing clip");
  assert(preparedAgain.clip.id === prepared.clip.id, "AutoEdit retry created a duplicate clip");

  console.log("AutoEdit full E2E PASSED", {
    candidateId: analyzed.analysis.candidates[0].id,
    clipId: prepared.clip.id,
    resolution: `${probe.width}x${probe.height}`,
    duration: probe.duration,
    sizeBytes: renderedStat.size,
    subtitles: prepared.clip.subtitles.style,
  });
} finally {
  if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
  else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;
  await rm(root, { recursive: true, force: true });
}

function segment(startTime, endTime, text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  const duration = endTime - startTime;
  return {
    id: `segment-${startTime}`,
    startTime,
    endTime,
    text,
    words: tokens.map((token, index) => ({
      startTime: startTime + (duration * index) / tokens.length,
      endTime: startTime + (duration * (index + 1)) / tokens.length,
      text: token,
    })),
  };
}

async function ffprobe(filePath) {
  const output = await run(process.env.FFPROBE_PATH?.trim() || "ffprobe", [
    "-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath,
  ]);
  const parsed = JSON.parse(output);
  const video = parsed.streams.find((stream) => stream.codec_type === "video");
  return {
    width: Number(video.width),
    height: Number(video.height),
    duration: Number(parsed.format.duration),
  };
}

async function hashFile(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} failed with code ${code ?? "?"}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
