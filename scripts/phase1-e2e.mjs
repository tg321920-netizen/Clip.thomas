import { createHash } from "node:crypto";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { ingestUrlJob } from "../services/ingest/UrlIngestService.mjs";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const port = 3107;
const baseUrl = `http://127.0.0.1:${port}`;
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "clipforge-phase1-"));
const mediaPath = path.join(tempRoot, "phase1.mp4");
const storagePath = path.join(tempRoot, "storage");

let server;

try {
  await generateSampleVideo(mediaPath);

  const nextBin = path.join(
    process.cwd(),
    "node_modules",
    "next",
    "dist",
    "bin",
    "next",
  );

  server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
    env: {
      ...process.env,
      CLIPFORGE_STORAGE_DIR: storagePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverLog = "";
  server.stdout.setEncoding("utf8");
  server.stderr.setEncoding("utf8");
  server.stdout.on("data", (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk;
  });

  await waitForServer(baseUrl, server, () => serverLog);

  const status = await jsonFetch(`${baseUrl}/api/system/media-status`);
  assert(
    status.ready &&
      status.tools?.ffmpeg?.available &&
      status.tools?.ffprobe?.available &&
      status.storage?.writable,
    "Media environment is not ready",
  );

  const media = await readFile(mediaPath);
  const uploadResponse = await fetch(`${baseUrl}/api/videos/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "video/mp4",
      "X-File-Name": "phase1.mp4",
      "X-File-Size": String(media.byteLength),
    },
    body: media,
  });

  const upload = await uploadResponse.json();
  assert(
    uploadResponse.ok,
    `Upload failed: ${upload.error || uploadResponse.status}`,
  );

  const created = await fetch(`${baseUrl}/api/videos/uploads`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: "resume.mp4", mimeType: "video/mp4", size: media.length }),
  });
  const { session } = await created.json();
  assert(created.ok && session.id, "Resumable session creation failed");
  const uploadHeaders = { "X-Upload-Token": session.token };
  const hash = createHash("sha256").update(media).digest("hex");
  const chunkUrl = `${baseUrl}/api/videos/uploads/${session.id}/chunks/0`;
  const partial = await fetch(chunkUrl, { method: "PUT", headers: { ...uploadHeaders, "X-Chunk-SHA256": hash }, body: media.subarray(0, 50) });
  assert(partial.status === 409, "Interrupted fragment must remain retryable");
  for (let repeat = 0; repeat < 2; repeat++) {
    const chunk = await fetch(chunkUrl, { method: "PUT", headers: { ...uploadHeaders, "X-Chunk-SHA256": hash }, body: media });
    assert(chunk.ok, "Chunk upload/retry failed");
    const result = await chunk.json(); assert(result.duplicate === (repeat === 1), "Duplicate detection failed");
  }
  const finish = await fetch(`${baseUrl}/api/videos/uploads/${session.id}`, { method: "POST", headers: uploadHeaders });
  assert(finish.status === 202, "Finalization must enqueue server processing");
  const previousRoot = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = storagePath;
  try {
    const jobs = new IngestJobStore(); const job = await jobs.claimNext();
    assert(job.id === session.id, "Upload was not persisted in the worker queue");
    const result = await ingestUrlJob(job); await jobs.complete(job, result);
  } finally {
    if (previousRoot === undefined) delete process.env.CLIPFORGE_STORAGE_DIR;
    else process.env.CLIPFORGE_STORAGE_DIR = previousRoot;
  }
  const finished = await fetch(`${baseUrl}/api/videos/uploads/${session.id}`, { headers: uploadHeaders });
  const finishStatus = await finished.json();
  assert(finishStatus.job.status === "COMPLETED" && finishStatus.job.result.video, "Worker result not visible over HTTP");

  const video = upload.video;
  assert(video, "Upload response is missing video metadata");
  assert(video.width === 640 && video.height === 360, "Unexpected resolution");
  assert(
    video.durationSeconds >= 1.8 && video.durationSeconds <= 2.2,
    `Unexpected duration: ${video.durationSeconds}`,
  );
  assert(video.codec, "Missing codec");
  assert(video.aspectRatio, "Missing aspect ratio");
  assert(video.projectId, "Missing project id");
  assert(video.posterUrl, "Missing poster URL");
  assert(video.sourceUrl, "Missing source URL");

  const posterResponse = await fetch(`${baseUrl}${video.posterUrl}`);
  assert(posterResponse.ok, "Poster request failed");
  const poster = Buffer.from(await posterResponse.arrayBuffer());
  assert(
    poster.length > 100 && poster[0] === 0xff && poster[1] === 0xd8,
    "Poster is not a valid JPEG",
  );

  const rangeResponse = await fetch(`${baseUrl}${video.sourceUrl}`, {
    headers: {
      Range: "bytes=0-1023",
    },
  });
  assert(rangeResponse.status === 206, "Source range request did not return 206");
  assert(
    rangeResponse.headers.get("accept-ranges")?.toLowerCase() === "bytes",
    "Source endpoint does not advertise byte ranges",
  );
  const rangeBytes = Buffer.from(await rangeResponse.arrayBuffer());
  assert(
    rangeBytes.length > 0 && rangeBytes.length <= 1024,
    "Source byte range has an invalid size",
  );

  const projects = await jsonFetch(`${baseUrl}/api/projects`);
  assert(Array.isArray(projects.projects), "Project list is not an array");
  const saved = projects.projects.find((project) => project.id === video.projectId);
  assert(saved, "Uploaded project was not persisted");
  assert(!("relativePath" in saved.source), "Internal storage path leaked via API");

  const savedSource = path.join(
    storagePath,
    "uploads",
    video.projectId,
    video.storedName,
  );
  const sourceStat = await stat(savedSource);
  assert(
    sourceStat.size === media.byteLength,
    "Persisted source size does not match uploaded video",
  );

  await writeFile(
    path.join(tempRoot, "result.json"),
    JSON.stringify(
      {
        passed: true,
        projectId: video.projectId,
        durationSeconds: video.durationSeconds,
        resolution: `${video.width}x${video.height}`,
        fps: video.fps,
        codec: video.codec,
        aspectRatio: video.aspectRatio,
      },
      null,
      2,
    ),
  );

  console.log("Phase 1 end-to-end test PASSED", {
    durationSeconds: video.durationSeconds,
    resolution: `${video.width}x${video.height}`,
    fps: video.fps,
    codec: video.codec,
    aspectRatio: video.aspectRatio,
  });
} finally {
  await stopServer(server);
  await rm(tempRoot, { recursive: true, force: true });
}

async function stopServer(child) {
  if (!child || child.exitCode !== null) return;

  child.kill("SIGTERM");

  await Promise.race([
    once(child, "exit"),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);

  if (child.exitCode === null) {
    child.kill("SIGKILL");
    await once(child, "exit").catch(() => undefined);
  }
}

async function generateSampleVideo(target) {
  await runCommand(process.env.FFMPEG_PATH?.trim() || "ffmpeg", [
    "-v",
    "error",
    "-y",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=640x360:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=1000:sample_rate=44100",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    target,
  ]);
}

async function waitForServer(url, child, getLog) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Server exited early.\n${getLog()}`);
    }

    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while Next starts.
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  throw new Error(`Server did not become ready.\n${getLog()}`);
}

async function jsonFetch(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();
  assert(response.ok, `Request failed: ${url} (${response.status})`);
  return payload;
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          stderr.trim() || `Command ${command} failed with code ${code ?? "?"}`,
        ),
      );
    });
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
