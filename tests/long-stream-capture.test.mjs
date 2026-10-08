import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { captureSegmentedStream } from "../services/ingest/UrlIngestService.mjs";

test("segmented stream capture processes more than the old 120 second limit", {
  skip: process.env.CLIPFORGE_RUN_MEDIA_TESTS !== "true"
    ? "Generación audiovisual pendiente de autorización; no se ejecuta con las pruebas ligeras."
    : false,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-long-stream-"));
  const input = path.join(root, "long-source.mp4");
  const uploadDir = path.join(root, "capture");
  await mkdir(uploadDir, { recursive: true });

  try {
    await run("ffmpeg", [
      "-v", "error", "-y",
      "-f", "lavfi", "-i", "testsrc=size=64x64:rate=1",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=8000",
      "-t", "125",
      "-c:v", "mpeg4",
      "-g", "10",
      "-q:v", "20",
      "-c:a", "aac",
      "-b:a", "32k",
      "-shortest",
      input,
    ]);

    const stages = [];
    const output = await captureSegmentedStream({
      url: input,
      uploadDir,
      captureSeconds: 125,
      segmentSeconds: 30,
      async onProgress(_progress, stage) {
        stages.push(stage);
      },
    });

    const duration = Number(
      (await run("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        output,
      ])).trim(),
    );

    assert.ok(duration > 120, `expected >120 seconds, received ${duration}`);
    assert.ok(stages.includes("CAPTURING_STREAM"));
    assert.ok(stages.includes("MERGING_SEGMENTS"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
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
      else reject(new Error(stderr.trim() || `${command} exited with ${code}`));
    });
  });
}

