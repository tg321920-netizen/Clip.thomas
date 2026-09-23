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
import { applySpeechFocus } from "../services/reframe/AutoReframeService.mjs";
import { resolveStoragePath } from "../lib/storage-paths.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-reframe-"));
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
    "sine=frequency=660:sample_rate=44100",
    "-t",
    "6",
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
      originalName: "auto-reframe-source.mp4",
      storedName: "source.mp4",
      sizeBytes: sourceStat.size,
      durationSeconds: 6,
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
      id: "transcript-reframe-e2e",
      projectId,
      videoId: "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b",
      status: "COMPLETED",
      provider: "whisper-cli",
      model: "tiny",
      language: "es",
      text: "Hola. Pausa. Ahora vuelvo a hablar.",
      segments: [
        {
          id: "segment-000001",
          startTime: 0.5,
          endTime: 1.8,
          text: "Hola, este es el primer tramo hablado.",
        },
        {
          id: "segment-000002",
          startTime: 3.2,
          endTime: 5.4,
          text: "Ahora vuelvo a hablar para activar el zoom.",
        },
      ],
      sourceKey: "auto-reframe-e2e",
      audioRelativePath: "transcripts/auto-reframe-e2e/audio.wav",
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      error: null,
    },
    analysis: {
      id: "analysis-reframe-e2e",
      projectId,
      status: "COMPLETED",
      provider: "test",
      sourceKey: "test",
      config: {
        minDuration: 1,
        maxDuration: 6,
        targetDuration: 5,
        maxCandidates: 1,
      },
      candidates: [
        {
          id: "candidate-0001",
          startTime: 0,
          endTime: 6,
          duration: 6,
          text: "Prueba real de Auto Focus.",
          title: "Auto Focus E2E",
          hook: "Prueba real de Auto Focus.",
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
    { framingMode: "FILL", quality: "FAST" },
  );

  const plan = await applySpeechFocus(projectId, created.clip.id, {
    zoom: 1.12,
    paddingBeforeMs: 0,
    paddingAfterMs: 0,
    mergeGapMs: 300,
  });

  assert(plan.enabled === true, "Auto Focus was not enabled");
  assert(plan.windows.length === 2, "Expected two speech windows");
  assert(plan.speakerAware === false, "V1 must not pretend speaker identity");

  const progress = [];
  const rendered = await renderClip(
    projectId,
    created.clip.id,
    (value) => progress.push(value),
  );

  assert(rendered.clip.status === "READY", "Clip did not become READY");
  assert(
    rendered.clip.render?.autoReframeApplied === true,
    "Render did not apply Auto Focus",
  );
  assert(rendered.clip.render?.width === 1080, "Rendered width is not 1080");
  assert(rendered.clip.render?.height === 1920, "Rendered height is not 1920");
  assert(progress.includes(100), "Render did not report 100% progress");

  const renderedPath = resolveStoragePath(rendered.clip.render.relativePath);
  const renderedStat = await stat(renderedPath);
  assert(renderedStat.size > 0, "Rendered MP4 is empty");

  const probe = await ffprobe(renderedPath);
  assert(probe.width === 1080 && probe.height === 1920, "ffprobe resolution mismatch");
  assert(probe.duration >= 5.6 && probe.duration <= 6.4, "Unexpected clip duration");

  const sourceHashAfter = await hashFile(sourcePath);
  assert(
    sourceHashAfter === sourceHashBefore,
    "Source video changed during Auto Focus rendering",
  );

  console.log("Auto Focus E2E PASSED", {
    clipId: created.clip.id,
    windows: plan.windows.length,
    zoom: plan.zoom,
    resolution: `${probe.width}x${probe.height}`,
    duration: probe.duration,
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
