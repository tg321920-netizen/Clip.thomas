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
  prepareNewsBrief,
  renderNewsBrief,
} from "../services/news/NewsService.mjs";
import { resolveStoragePath } from "../lib/storage-paths.mjs";

const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-news-"));
const storage = path.join(root, "storage");
const projectId = "8e56073f-ae3a-4c2c-a73d-b11085dbd1b6";
const videoId = "15b0e6f2-72cb-4cf2-a3ad-a2a5f27e694b";
const projectsDir = path.join(storage, "projects");
const uploadDir = path.join(storage, "uploads", projectId);
const posterPath = path.join(uploadDir, "poster.jpg");
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
    "testsrc2=size=1280x720:rate=1",
    "-frames:v",
    "1",
    posterPath,
  ]);

  const posterHashBefore = await hashFile(posterPath);

  const segments = [
    {
      id: "segment-1",
      startTime: 0,
      endTime: 8,
      text: "Una empresa anunció hoy un nuevo sistema de inteligencia artificial para teléfonos móviles.",
    },
    {
      id: "segment-2",
      startTime: 8,
      endTime: 17,
      text: "La tecnología procesará parte de la información directamente en el dispositivo.",
    },
    {
      id: "segment-3",
      startTime: 17,
      endTime: 28,
      text: "Según la presentación, el software estará disponible primero en tres modelos nuevos.",
    },
    {
      id: "segment-4",
      startTime: 28,
      endTime: 39,
      text: "La compañía dijo que la función busca reducir el tiempo necesario para responder a tareas frecuentes.",
    },
  ];

  const project = {
    id: projectId,
    createdAt: new Date().toISOString(),
    source: {
      projectId,
      videoId,
      originalName: "news-source.mp4",
      storedName: "source.mp4",
      sizeBytes: 1000,
      durationSeconds: 39,
      width: 1280,
      height: 720,
      fps: 30,
      codec: "h264",
      container: "mp4",
      aspectRatio: "16:9",
      posterUrl: `/api/projects/${projectId}/poster`,
      sourceUrl: `/api/projects/${projectId}/source`,
      relativePath: `uploads/${projectId}/source.mp4`,
    },
    transcript: {
      id: "transcript-news-e2e",
      projectId,
      videoId,
      status: "COMPLETED",
      provider: "whisper-cli",
      model: "tiny",
      language: "es",
      text: segments.map((segment) => segment.text).join(" "),
      segments,
      sourceKey: "news-source",
      audioRelativePath: `transcripts/${projectId}/audio.wav`,
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

  const prepared = await prepareNewsBrief(projectId, { targetWords: 75 });
  assert(prepared.reused === false, "First News brief must be new");
  assert(prepared.newsBrief.category === "TECH", "News category was not TECH");
  assert(prepared.newsBrief.template === "TECH", "News template was not TECH");
  assert(prepared.newsBrief.sourceEvidence.length > 0, "News evidence is empty");

  const sourceText = segments.map((segment) => segment.text).join(" ");
  assert(
    prepared.newsBrief.sourceEvidence.every((evidence) =>
      sourceText.includes(evidence.text),
    ),
    "News evidence contains text outside the transcript",
  );

  const progress = [];
  const rendered = await renderNewsBrief(projectId, (value) => progress.push(value));

  assert(rendered.newsBrief.status === "RENDERED", "News render did not finish");
  assert(rendered.newsBrief.render?.width === 1080, "News render width is not 1080");
  assert(rendered.newsBrief.render?.height === 1920, "News render height is not 1920");
  assert(rendered.newsBrief.render?.ttsProvider === "espeak-ng", "Unexpected TTS provider");
  assert(progress.includes(100), "News render never reported 100% progress");

  const renderedPath = resolveStoragePath(rendered.newsBrief.render.relativePath);
  const renderedStat = await stat(renderedPath);
  assert(renderedStat.size > 0, "News MP4 is empty");

  const probe = await ffprobe(renderedPath);
  assert(probe.width === 1080 && probe.height === 1920, "News ffprobe resolution mismatch");
  assert(probe.duration > 1, "News video duration is invalid");
  assert(probe.hasAudio, "News video has no narration audio");

  const posterHashAfter = await hashFile(posterPath);
  assert(posterHashAfter === posterHashBefore, "News render modified the source poster");

  const second = await renderNewsBrief(projectId);
  assert(second.reused === true, "Rendered news video should be reused");

  console.log("News Mode E2E PASSED", {
    category: rendered.newsBrief.category,
    template: rendered.newsBrief.template,
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
  const audio = parsed.streams.find((stream) => stream.codec_type === "audio");

  return {
    width: Number(video?.width || 0),
    height: Number(video?.height || 0),
    duration: Number(parsed.format?.duration || 0),
    hasAudio: Boolean(audio),
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
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

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
