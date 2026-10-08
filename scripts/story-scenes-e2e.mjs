import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, copyFile, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { SceneStoryService } from "../services/owned-content/SceneStoryService.mjs";
import { runMedia } from "../services/media-processing/MediaValidationService.mjs";
import { verifySubtitleFrame } from "./verify-subtitle-frame.mjs";
const root = path.resolve("artifacts/story-scenes/storage"), output = path.dirname(root);
process.env.CLIPFORGE_STORAGE_DIR = root; await mkdir(path.join(root, "story-assets"), { recursive: true });
const images = [];
for (let i = 1; i <= 6; i++) { const relative = `story-assets/${randomUUID()}.jpg`; await copyFile(`tests/fixtures/maya-story/scene-${i}.jpg`, path.join(root, relative)); images.push(relative); }
const id = randomUUID();
const result = await new SceneStoryService({ width: 360, height: 640 }).render(id, { topic: "Crea una historia de 60 segundos sobre una ciudad maya perdida en la selva, con misterio, narración en español e imágenes cinematográficas.", duration: 60, images, subtitles: true });
assert.equal(result.validation.valid, true); assert.ok(Math.abs(result.validation.duration - 60) < 0.5); assert.equal(result.validation.audioCodec, "aac");
const manifest = JSON.parse(await readFile(path.join(root, "stories", id, "manifest.json"), "utf8"));
assert.equal(manifest.plan.scenes.length, 6); assert.ok(manifest.cues.length >= 6);
const frameHashes = [];
for (let i = 0; i < 6; i++) {
  const scene = manifest.plan.scenes[i]; const time = scene.startTime + scene.duration / 2;
  const sample = await runMedia("ffmpeg", ["-v", "error", "-ss", String(time), "-i", path.join(root, result.relativePath), "-frames:v", "1", "-f", "framemd5", "-"]);
  frameHashes.push(sample.stdout.trim().split("\n").at(-1).split(",").at(-1).trim());
  await runMedia("ffmpeg", ["-v", "error", "-y", "-ss", String(time), "-i", path.join(root, result.relativePath), "-frames:v", "1", path.join(output, `scene-${i + 1}.jpg`)]);
}
assert.equal(new Set(frameHashes).size, 6, "The six scenes must show different real images");
const subtitleEvidence=await verifySubtitleFrame({file:path.join(root,result.relativePath),cue:manifest.cues[0],width:360,height:640,output:path.join(output,"subtitle-review")});
await copyFile(path.join(root, result.relativePath), path.join(output, "maya-60s.mp4"));
await writeFile(path.join(output, "evidence.json"), JSON.stringify({ ...result, frameHashes, manifest,subtitleEvidence }, null, 2));
console.log(JSON.stringify({ passed: true, file: "artifacts/story-scenes/maya-60s.mp4", provider: manifest.plan.provider, scenes: 6, frameHashes, validation: result.validation }, null, 2));
