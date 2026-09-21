import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JobStore } from "../services/JobStore.mjs";
import { transcribeProject } from "../services/transcription/TranscriptionService.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-whisper-"));
const storage = path.join(root, "storage");
const projectId = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const videoId = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";
const uploadDir = path.join(storage, "uploads", projectId);
const projectsDir = path.join(storage, "projects");
const sourcePath = path.join(uploadDir, "source.mp4");
const speechPath = path.join(root, "speech.wav");

const previousStorage = process.env.CLIPFORGE_STORAGE_DIR;
const previousModel = process.env.WHISPER_MODEL;
const previousLanguage = process.env.WHISPER_LANGUAGE;

process.env.CLIPFORGE_STORAGE_DIR = storage;
process.env.WHISPER_MODEL = process.env.WHISPER_MODEL || "tiny";
process.env.WHISPER_LANGUAGE = process.env.WHISPER_LANGUAGE || "es";

try {
  await mkdir(uploadDir, { recursive: true });
  await mkdir(projectsDir, { recursive: true });

  await run("espeak-ng", [
    "-v",
    "es",
    "-s",
    "135",
    "-w",
    speechPath,
    "Hola mundo. Este es un video de prueba para ClipForge. Estamos verificando la transcripcion automatica.",
  ]);

  await run(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-i",
    speechPath,
    "-shortest",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    sourcePath,
  ]);

  const sourceStat = await import("node:fs/promises").then(({ stat }) =>
    stat(sourcePath),
  );

  const project = {
    id: projectId,
    createdAt: new Date().toISOString(),
    source: {
      projectId,
      videoId,
      originalName: "whisper-real-test.mp4",
      storedName: "source.mp4",
      sizeBytes: sourceStat.size,
      posterUrl: `/api/projects/${projectId}/poster`,
      sourceUrl: `/api/projects/${projectId}/source`,
      durationSeconds: 8,
      width: 640,
      height: 360,
      fps: 30,
      codec: "h264",
      container: "mp4",
      aspectRatio: "16:9",
      relativePath: path.posix.join("uploads", projectId, "source.mp4"),
    },
  };

  await writeFile(
    path.join(projectsDir, `${projectId}.json`),
    JSON.stringify(project, null, 2),
    "utf8",
  );

  const jobs = new JobStore();
  const queued = await jobs.enqueueTranscription(projectId);
  assert(queued.status === "QUEUED", "Transcription job was not queued");

  await run(process.execPath, ["scripts/transcription-worker.mjs", "--once"], {
    env: {
      ...process.env,
      CLIPFORGE_STORAGE_DIR: storage,
      WHISPER_MODEL: process.env.WHISPER_MODEL,
      WHISPER_LANGUAGE: process.env.WHISPER_LANGUAGE,
    },
  });

  const stored = JSON.parse(
    await readFile(path.join(projectsDir, `${projectId}.json`), "utf8"),
  );

  assert(stored.transcript?.status === "COMPLETED", "Transcript did not complete");
  assert(
    Array.isArray(stored.transcript.segments) &&
      stored.transcript.segments.length > 0,
    "Whisper produced no segments",
  );

  for (const segment of stored.transcript.segments) {
    assert(Number.isFinite(segment.startTime), "Segment startTime is invalid");
    assert(Number.isFinite(segment.endTime), "Segment endTime is invalid");
    assert(segment.endTime > segment.startTime, "Segment timestamps are invalid");
    assert(String(segment.text || "").trim().length > 0, "Segment text is empty");
  }

  const completedJob = await jobs.getTranscriptionJob(projectId);
  assert(completedJob?.status === "COMPLETED", "Job did not complete");

  const reused = await transcribeProject(projectId, {
    provider: {
      async transcribe() {
        throw new Error("Provider should not run for a current transcript");
      },
    },
  });

  assert(reused.reused === true, "Existing transcript was not reused");

  const duplicateJob = await jobs.enqueueTranscription(projectId);
  assert(
    duplicateJob.status === "COMPLETED",
    "Completed transcription job was duplicated",
  );

  console.log("Real Whisper transcription E2E PASSED", {
    model: stored.transcript.model,
    language: stored.transcript.language,
    segments: stored.transcript.segments.length,
    textPreview: stored.transcript.text.slice(0, 120),
  });
} finally {
  restore("CLIPFORGE_STORAGE_DIR", previousStorage);
  restore("WHISPER_MODEL", previousModel);
  restore("WHISPER_LANGUAGE", previousLanguage);
  await rm(root, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.stderr?.on("data", (chunk) => { stderr += chunk; });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        if (stdout.trim()) process.stdout.write(stdout);
        resolve();
        return;
      }

      reject(
        new Error(
          stderr.trim() ||
            stdout.trim() ||
            `${command} failed with code ${code ?? "?"}`,
        ),
      );
    });
  });
}

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
