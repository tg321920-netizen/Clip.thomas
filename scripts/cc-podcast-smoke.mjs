import { randomUUID } from "node:crypto";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { getStorageRoot } from "../lib/storage-paths.mjs";
import { replaceProjectFile, loadProjectFile } from "../lib/project-files.mjs";
import { transcribeProject } from "../services/transcription/TranscriptionService.mjs";
import { analyzeProject } from "../services/analysis/ContentAnalysisService.mjs";
import { createClipFromCandidate, renderClip } from "../services/clip/ClipService.mjs";
import { generateSubtitleTrack } from "../services/subtitles/SubtitleService.mjs";

const FEED_URL = "https://podcastlinux.com/feed";
const EPISODE_TITLE = "#194 Distros Madres II";
const EPISODE_PAGE = "https://podcastlinux.com/posts/podcastlinux/194-Podcast-Linux/";
const LICENSE = {
  name: "Creative Commons Reconocimiento-CompartirIgual 4.0 Internacional",
  shortName: "CC BY-SA 4.0",
  url: "https://creativecommons.org/licenses/by-sa/4.0/",
  attribution: "Podcast Linux · Juan Febles · episodio #194 Distros Madres II",
};
const MAX_SOURCE_SECONDS = Math.max(
  180,
  Math.min(Number(process.env.CLIPFORGE_CC_PODCAST_SECONDS || 90), 120),
);

const marker = process.env.CLIPFORGE_CC_PODCAST_SMOKE_MARKER || "podcastlinux-194-v1";
const root = getStorageRoot();
const smokeDir = path.join(root, "smoke-tests", marker);
const resultPath = path.join(smokeDir, "result.json");

await mkdir(smokeDir, { recursive: true });

try {
  const existing = await readJson(resultPath);
  if (existing?.status === "COMPLETED" && existing?.projectId) {
    console.log("[cc-podcast-smoke] already completed", existing);
    process.exit(0);
  }

  console.log("[cc-podcast-smoke] resolving licensed Spanish podcast source...");
  const enclosureUrl = await resolveEpisodeEnclosure(FEED_URL, EPISODE_TITLE);

  const projectId = randomUUID();
  const videoId = randomUUID();
  const uploadDir = path.join(root, "uploads", projectId);
  const sourcePath = path.join(uploadDir, "source.mp4");
  await mkdir(uploadDir, { recursive: true });

  console.log("[cc-podcast-smoke] creating test video from CC BY-SA podcast audio", {
    title: EPISODE_TITLE,
    seconds: MAX_SOURCE_SECONDS,
  });
  await createPodcastVideo(enclosureUrl, sourcePath, MAX_SOURCE_SECONDS);

  const probe = await probeVideo(sourcePath);
  const info = await stat(sourcePath);
  const now = new Date().toISOString();

  await replaceProjectFile(projectId, {
    id: projectId,
    createdAt: now,
    source: {
      projectId,
      videoId,
      originalName: "Podcast Linux 194 - Distros Madres II (CC BY-SA 4.0).mp4",
      storedName: "source.mp4",
      sizeBytes: info.size,
      durationSeconds: probe.durationSeconds,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      codec: probe.codec,
      container: probe.container,
      aspectRatio: probe.aspectRatio,
      relativePath: path.posix.join("uploads", projectId, "source.mp4"),
      sourceUrl: `/api/projects/${projectId}/source`,
      originUrl: EPISODE_PAGE,
      ingestMode: "LICENSED_PODCAST_SMOKE",
      rights: LICENSE,
    },
    smokeTest: {
      marker,
      kind: "LICENSED_SPANISH_PODCAST",
      title: EPISODE_TITLE,
      feedUrl: FEED_URL,
      episodePage: EPISODE_PAGE,
      license: LICENSE,
      sourceSeconds: MAX_SOURCE_SECONDS,
      publicationEnabled: false,
      createdAt: now,
    },
  });

  console.log("[cc-podcast-smoke] transcribing...");
  const transcription = await transcribeProject(projectId, {
    language: "es",
    chunkDurationSeconds: 600,
  });

  console.log("[cc-podcast-smoke] analyzing...");
  const analysisResult = await analyzeProject(projectId, {
    providerName: "heuristic",
    minDuration: 20,
    maxDuration: 55,
    targetDuration: 35,
    maxCandidates: 5,
  });

  const candidates = analysisResult.analysis?.candidates || [];
  if (candidates.length === 0) throw new Error("No clip candidates were generated.");
  const candidate = candidates[0];

  console.log("[cc-podcast-smoke] creating best clip candidate", {
    candidateId: candidate.id,
    viralScore: candidate.viralScore,
    startTime: candidate.startTime,
    endTime: candidate.endTime,
  });

  const prepared = await createClipFromCandidate(projectId, candidate.id, {
    framingMode: "FIT",
    quality: "FAST",
  });

  await generateSubtitleTrack(projectId, prepared.clip.id, {
    style: "VIRAL",
    enabled: true,
  });

  console.log("[cc-podcast-smoke] rendering 9:16 clip with subtitles...");
  const rendered = await renderClip(projectId, prepared.clip.id, (progress) => {
    if (progress === 100 || progress % 25 === 0) {
      console.log("[cc-podcast-smoke] render progress", progress);
    }
  });

  const project = await loadProjectFile(projectId);
  const finalClip = project?.clips?.find((clip) => clip.id === prepared.clip.id);
  const result = {
    status: "COMPLETED",
    projectId,
    clipId: prepared.clip.id,
    candidateId: candidate.id,
    viralScore: candidate.viralScore,
    clipStartTime: candidate.startTime,
    clipEndTime: candidate.endTime,
    clipDuration: candidate.duration,
    transcriptSegments: transcription.transcript?.segments?.length || 0,
    candidateCount: candidates.length,
    render: rendered.clip?.render || finalClip?.render || null,
    rights: LICENSE,
    episodePage: EPISODE_PAGE,
    publicationAttempted: false,
    completedAt: new Date().toISOString(),
  };

  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8");
  console.log("[cc-podcast-smoke] COMPLETED", result);
} catch (error) {
  const result = {
    status: "FAILED",
    error: error instanceof Error ? error.message : String(error),
    failedAt: new Date().toISOString(),
  };
  await writeFile(resultPath, JSON.stringify(result, null, 2), "utf8").catch(() => undefined);
  console.error("[cc-podcast-smoke] FAILED", result);
  process.exitCode = 1;
}

async function resolveEpisodeEnclosure(feedUrl, titleNeedle) {
  const response = await fetch(feedUrl, {
    headers: { "user-agent": "ClipForge/0.1 licensed-content-smoke-test" },
  });
  if (!response.ok) throw new Error(`Podcast feed returned HTTP ${response.status}.`);
  const xml = await response.text();
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  const item = items.find((value) => decodeXml(value).includes(titleNeedle));
  if (!item) throw new Error(`Could not find episode "${titleNeedle}" in podcast feed.`);
  const enclosure = item.match(/<enclosure\b[^>]*\burl=["']([^"']+)["'][^>]*>/i);
  if (!enclosure?.[1]) throw new Error("Podcast episode has no enclosure URL.");
  return normalizePodcastMediaUrl(decodeXml(enclosure[1]));
}

async function createPodcastVideo(audioUrl, outputPath, seconds) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  await run(ffmpeg, [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-f", "lavfi",
    "-i", "color=c=0x101820:s=640x360:r=5",
    "-i", audioUrl,
    "-t", String(seconds),
    "-map", "0:v:0",
    "-map", "1:a:0",
    "-c:v", "libx264",
    "-preset", "ultrafast",
    "-tune", "stillimage",
    "-crf", "32",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "96k",
    "-shortest",
    "-movflags", "+faststart",
    outputPath,
  ], 8 * 60 * 1000);
}

async function probeVideo(filePath) {
  const ffprobe = process.env.FFPROBE_PATH?.trim() || "ffprobe";
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-print_format", "json",
    "-show_format", "-show_streams",
    filePath,
  ], 120000);
  const parsed = JSON.parse(stdout);
  const video = parsed.streams?.find((stream) => stream.codec_type === "video");
  const duration = Number(parsed.format?.duration || video?.duration || 0);
  const width = Number(video?.width || 0);
  const height = Number(video?.height || 0);
  if (!width || !height || !Number.isFinite(duration) || duration <= 0) {
    throw new Error("Generated podcast test video is invalid.");
  }
  return {
    durationSeconds: round(duration),
    width,
    height,
    fps: round(parseRate(video.avg_frame_rate || video.r_frame_rate)),
    codec: video.codec_name || "unknown",
    container: parsed.format?.format_name?.split(",")[0] || "unknown",
    aspectRatio: reduceRatio(width, height),
  };
}

function run(command, args, timeoutMs = 0) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    const timer = timeoutMs > 0 ? setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Process timeout: ${command}`));
    }, timeoutMs) : null;
    timer?.unref?.();
    child.on("error", reject);
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim().slice(-3000) || `${command} exited with code ${code}`));
    });
  });
}

async function readJson(filePath) {
  try {
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizePodcastMediaUrl(value) {
  const url = String(value || "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "op3.dev") {
      const marker = "/archive.org/";
      const index = parsed.pathname.indexOf(marker);
      if (index >= 0) {
        return `https://archive.org/${parsed.pathname.slice(index + marker.length)}`;
      }
    }
  } catch {
    // Keep the original URL; FFmpeg will surface a clear error if invalid.
  }
  return url;
}

function decodeXml(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function parseRate(rate) {
  const [a, b] = String(rate || "0").split("/").map(Number);
  if (!Number.isFinite(a)) return 0;
  return b ? a / b : a;
}

function reduceRatio(width, height) {
  const d = gcd(width, height);
  return `${width / d}:${height / d}`;
}

function gcd(a, b) {
  let x = Math.abs(a), y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
