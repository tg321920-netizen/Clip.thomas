// Linux-only process peak measurements on an actual authorized 1080p story.
// No API calls, publishing, or changes to the source video.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { STORY_X264_PARAMS } from "../services/owned-content/SceneStoryService.mjs";
import { probeMediaFile, runMedia } from "../services/media-processing/MediaValidationService.mjs";
import { hashFile } from "../services/ingest/ResumableUploadStore.mjs";

assert.equal(process.platform, "linux", "resource.ru_maxrss is measured in KiB on this Linux benchmark");
let source = process.argv[2];
if (!source) {
  const { directory } = JSON.parse(await readFile("artifacts/spanish-reflections/latest.json", "utf8"));
  source = JSON.parse(await readFile(path.join(directory, "evidence.json"), "utf8")).filename;
}
source = path.resolve(source); assert.ok((await stat(source)).isFile());
const input = await probeMediaFile(source);
assert.ok(input.duration >= 14 && input.video?.width === 1080 && input.video.height === 1920, "Use a real 1080x1920 story of at least 14 seconds");
const parent = path.resolve("artifacts/story-memory"); await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "run-"));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const graph = "[0:v]settb=AVTB,setpts=PTS-STARTPTS,fps=30,format=yuv420p[a];[1:v]settb=AVTB,setpts=PTS-STARTPTS,fps=30,format=yuv420p[b];[a][b]xfade=transition=fade:duration=0.35:offset=3.65,scale=in_range=auto:out_range=tv,format=yuv420p,setparams=range=limited[out]";
const common = [ffmpeg, "-v", "error", "-y", "-filter_complex_threads", "1", "-threads", "1", "-t", "4", "-i", source, "-threads", "1", "-ss", "10", "-t", "4", "-i", source, "-filter_complex", graph, "-map", "[out]", "-an", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30"];

async function measure(label, argv) {
  // A fresh Python parent gives each command its own kernel-recorded peak.
  const python = "import subprocess,resource,time,json,sys; t=time.perf_counter(); subprocess.run(json.loads(sys.argv[1]),check=True); print(json.dumps({'maxRssKiB':resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,'seconds':time.perf_counter()-t}))";
  return new Promise((resolve, reject) => {
    const child = spawn("python3", ["-c", python, JSON.stringify(argv)], { shell: false, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch { /* Already exited. */ } }, 240000);
    child.stdout.on("data", part => { stdout = (stdout + part).slice(-3000); });
    child.stderr.on("data", part => { stderr = (stderr + part).slice(-3000); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`${label}: ${stderr || "command failed"}`));
      try { resolve({ label, ...JSON.parse(stdout) }); } catch (error) { reject(error); }
    });
  });
}

const beforeFile = path.join(directory, "before.mp4"), afterFile = path.join(directory, "after.mp4");
const before = await measure("original-x264", [...common, beforeFile]);
const after = await measure("bounded-lookahead", [...common, "-x264-params", STORY_X264_PARAMS, afterFile]);
const decodeBefore = await measure("original-decode", [ffmpeg, "-v", "error", "-xerror", "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"]);
const decodeAfter = await measure("bounded-decode", [ffmpeg, "-v", "error", "-threads", "1", "-filter_threads", "1", "-xerror", "-i", source, "-map", "0:v:0", "-map", "0:a:0?", "-f", "null", "-"]);
const comparison = await runMedia(ffmpeg, ["-hide_banner", "-v", "info", "-threads", "1", "-i", beforeFile, "-threads", "1", "-i", afterFile, "-filter_complex_threads", "1", "-filter_complex", "[0:v][1:v]ssim", "-an", "-f", "null", "-"]);
const ssim = Number(comparison.stderr.match(/All:([0-9.]+)/)?.[1]);
assert.ok(ssim >= 0.98, `Encoded versions differ too much for this fixture: SSIM ${ssim}`);
assert.ok(after.maxRssKiB < before.maxRssKiB * 0.9, "Expected at least 10% encoder peak reduction");
assert.ok(decodeAfter.maxRssKiB < decodeBefore.maxRssKiB, "Bounded decoder must reduce its peak");
const evidence = { passed: true, testedAt: new Date().toISOString(), source, sourceSha256: await hashFile(source), before, after, decodeBefore, decodeAfter, x264Params: STORY_X264_PARAMS, ssimBetweenEncodes: ssim, encoderReduction: 1 - after.maxRssKiB / before.maxRssKiB, totalServerMemoryCertified: false, publishing: "OFF" };
await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
await writeFile(path.join(parent, "latest.json"), JSON.stringify({ directory }));
console.log(JSON.stringify({ ...evidence, evidence: path.join(directory, "evidence.json") }));
