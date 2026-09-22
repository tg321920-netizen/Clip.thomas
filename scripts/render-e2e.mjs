import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createClipFromCandidate,
  renderClip,
} from "../services/clip/ClipService.mjs";
import { resolveStoragePath } from "../lib/storage-paths.mjs";
import { generateSubtitleTrack } from "../services/subtitles/SubtitleService.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-render-"));
const storage = path.join(root, "storage");
const projectId = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const projectsDir = path.join(storage, "projects");
const uploadDir = path.join(storage, "uploads", projectId);
const sourcePath = path.join(uploadDir, "source.mp4");

const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
process.env.CLIPFORGE_STORAGE_DIR = storage;

try {
  await mkdir(projectsDir, { recursive: true });
  await mkdir(uploadDir, { recursive: true });

  await run(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=24",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=880:sample_rate=44100",
    "-t",
    "4",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    sourcePath,
  ]);

  const sourceStat = await stat(sourcePath);
  const sourceHashBefore = await hashFile(sourcePath);

  const project = {
    id: projectId,
    createdAt: new Date().toISOString(),
    source: {
      projectId,
      videoId: "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b",
      originalName: "render-source.mp4",
      storedName: "source.mp4",
      sizeBytes: sourceStat.size,
      durationSeconds: 4,
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
      id: "transcript-render-e2e",
      projectId,
      videoId: "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b",
      status: "COMPLETED",
      provider: "whisper-cli",
      model: "tiny",
      language: "es",
      text: "Hola mundo esta es una prueba real de subtitulos.",
      segments: [
        {
          id: "segment-000001",
          startTime: 0.5,
          endTime: 3,
          text: "Hola mundo esta es una prueba real de subtitulos.",
          words: [
            { startTime: 0.5, endTime: 0.85, text: "Hola" },
            { startTime: 0.85, endTime: 1.2, text: "mundo" },
            { startTime: 1.2, endTime: 1.5, text: "esta" },
            { startTime: 1.5, endTime: 1.8, text: "es" },
            { startTime: 1.8, endTime: 2.05, text: "una" },
            { startTime: 2.05, endTime: 2.35, text: "prueba" },
            { startTime: 2.35, endTime: 2.6, text: "real" },
            { startTime: 2.6, endTime: 2.8, text: "de" },
            { startTime: 2.8, endTime: 3, text: "subtitulos." },
          ],
        },
      ],
      sourceKey: "render-e2e",
      audioRelativePath: "transcripts/render-e2e/audio.wav",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    },
    analysis: {
      id: "analysis-1",
      projectId,
      status: "COMPLETED",
      provider: "transcript-heuristic-v1",
      sourceKey: "test",
      config: {
        minDuration: 1,
        maxDuration: 4,
        targetDuration: 2.5,
        maxCandidates: 1,
      },
      candidates: [
        {
          id: "candidate-0001",
          startTime: 0.5,
          endTime: 3,
          duration: 2.5,
          text: "Prueba real de render.",
          title: "Prueba real",
          hook: "Prueba real de render.",
          reason: "E2E",
          viralScore: 50,
          status: "CANDIDATE",
          analysisMethod: "test",
          components: {
            hook: 50,
            semanticInterest: 50,
            emotionTone: 50,
            audioEnergy: null,
            standaloneComprehensibility: 50,
            durationFit: 50,
          },
          reasons: ["E2E"],
          confidence: "MEDIUM",
          disclaimer: "test",
        },
      ],
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    },
  };

  await writeFile(
    path.join(projectsDir, `${projectId}.json`),
    JSON.stringify(project, null, 2),
    "utf8",
  );

  const created = await createClipFromCandidate(
    projectId,
    "candidate-0001",
    {
      framingMode: "FILL",
      quality: "FAST",
    },
  );

  assert(created.reused === false, "First clip creation must be new");

  const subtitles = await generateSubtitleTrack(
    projectId,
    created.clip.id,
    {
      style: "KARAOKE",
      enabled: true,
    },
  );

  assert(subtitles.enabled === true, "Subtitles were not enabled");
  assert(subtitles.style === "KARAOKE", "Subtitle style was not persisted");
  assert(subtitles.cues.length > 0, "No subtitle cues were generated");

  const progress = [];
  const rendered = await renderClip(
    projectId,
    created.clip.id,
    (value) => progress.push(value),
  );

  assert(rendered.clip.status === "READY", "Clip did not become READY");
  assert(rendered.clip.render?.width === 1080, "Rendered width is not 1080");
  assert(rendered.clip.render?.height === 1920, "Rendered height is not 1920");
  assert(
    rendered.clip.render?.sourceUrl?.includes(created.clip.id),
    "Rendered clip URL is missing clip id",
  );
  assert(
    rendered.clip.render?.subtitlesBurned === true,
    "Rendered clip did not burn subtitles",
  );
  assert(progress.some((value) => value === 100), "Render did not report 100%");

  const renderedPath = resolveStoragePath(rendered.clip.render.relativePath);
  const renderedStat = await stat(renderedPath);
  assert(renderedStat.size > 0, "Rendered MP4 is empty");

  const assPath = path.join(
    storage,
    "clips",
    projectId,
    created.clip.id,
    "subtitles.ass",
  );
  const assText = await readFile(assPath, "utf8");
  assert(/Dialogue: 0/.test(assText), "ASS subtitle file has no dialogue");
  assert(/\\k/.test(assText), "Karaoke ASS tags were not generated");

  const probe = await ffprobe(renderedPath);
  assert(probe.width === 1080 && probe.height === 1920, "ffprobe resolution mismatch");
  assert(probe.duration >= 2.2 && probe.duration <= 2.8, "Unexpected clip duration");

  const sourceHashAfter = await hashFile(sourcePath);
  assert(
    sourceHashAfter === sourceHashBefore,
    "Source video changed during rendering",
  );

  const second = await renderClip(projectId, created.clip.id);
  assert(second.reused === true, "Ready render should be reused");

  const storedAfterRender = JSON.parse(
    await readFile(path.join(projectsDir, `${projectId}.json`), "utf8"),
  );
  const storedClip = storedAfterRender.clips.find(
    (clip) => clip.id === created.clip.id,
  );
  storedClip.status = "FAILED";
  storedClip.error = "synthetic transient failure";
  await writeFile(
    path.join(projectsDir, `${projectId}.json`),
    JSON.stringify(storedAfterRender, null, 2),
    "utf8",
  );

  const retryCandidate = await createClipFromCandidate(
    projectId,
    "candidate-0001",
    {
      framingMode: "FILL",
      quality: "FAST",
    },
  );
  assert(retryCandidate.reused === true, "Failed clip should be reused for retry");
  assert(
    retryCandidate.clip.id === created.clip.id,
    "Retry must not create a duplicate clip record",
  );

  console.log("Clip render E2E PASSED", {
    clipId: created.clip.id,
    resolution: `${probe.width}x${probe.height}`,
    duration: probe.duration,
    sizeBytes: renderedStat.size,
  });
} finally {
  if (previousStorage === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
  else process.env.CLIPFORGE_STORAGE_DIR = previousStorage;

  await rm(root, { recursive: true, force: true });
}

async function ffprobe(filePath) {
  const output = await run(process.env.FFPROBE_PATH?.trim() || "ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
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
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

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
