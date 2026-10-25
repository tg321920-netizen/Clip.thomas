// Original Spanish script, licensed photographs, local neural voice and ASR.
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile, copyFile, open } from "node:fs/promises";
import path from "node:path";
import { JobStore } from "../services/JobStore.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
import { LocalNeuralNarrationProvider } from "../services/owned-content/LocalNeuralNarrationProvider.mjs";
import { R2ObjectStore, readR2Config } from "../services/storage/R2ObjectStore.mjs";
import { ClipLibraryService } from "../services/storage/ClipLibraryService.mjs";
import { runMedia, probeMediaFile } from "../services/media-processing/MediaValidationService.mjs";
import { hashFile } from "../services/ingest/ResumableUploadStore.mjs";
import { verifySubtitleFrame, selectSubtitleReviewCue } from "./verify-subtitle-frame.mjs";

const archive = process.argv.includes("--r2"), config = archive ? readR2Config() : null;
if (archive && !config) throw new Error("R2 is not configured; cloud persistence cannot be certified.");
const parent = path.resolve("artifacts/spanish-reflections"); await mkdir(parent, { recursive: true });
const directory = process.env.CLIPFORGE_REFLECTION_RUN || await mkdtemp(path.join(parent, "run-"));
process.env.CLIPFORGE_STORAGE_DIR = path.join(directory, "storage"); process.env.CLIPFORGE_MEDIA_STORAGE_PROVIDER = "local";
process.env.CLIPFORGE_MEDIA_WIDTH = "1080"; process.env.CLIPFORGE_MEDIA_HEIGHT = "1920";
for (const key of ["CLIPFORGE_REDIS_URL", "REDIS_URL"]) delete process.env[key];
for (const key of ["CLIPFORGE_AGENT_ENABLED", "CLIPFORGE_AGENT_REAL_PUBLISHING", "CLIPFORGE_CONTENT_REAL_PUBLISHING", "CLIPFORGE_SMART_PUBLISH_ON_BOOT", "CLIPFORGE_STORY_EXTERNAL_AUTHORIZED"]) process.env[key] = "false";
const stories = JSON.parse(await readFile(new URL("./fixtures/spanish-reflections.json", import.meta.url), "utf8"));
const input = { title: stories[0].title, topic: stories[0].title, narration: stories[0].scenes.join(" "), duration: 40, format: "9:16", sceneCount: 6, generationMode: "LIBRARY", voiceMode: "LOCAL", storyProfile: "SHORT_REFLECTION", subtitles: true };
const store = new JobStore();
const previous = process.env.CLIPFORGE_REFLECTION_RUN ? JSON.parse(await readFile(path.join(directory, "run.json"), "utf8")) : null;
const job = previous ? await store.enqueueMedia("MEDIA_STORY", previous.projectId, input) : await store.enqueueMedia("MEDIA_STORY", randomUUID(), input);
await writeFile(path.join(directory, "run.json"), JSON.stringify({ projectId: job.projectId, jobId: job.id }));
const log = await open(path.join(directory, "worker.log"), "w");
const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ["scripts/media-worker.mjs", "--once"], { env: process.env, stdio: ["ignore", log.fd, log.fd] }); child.on("error", reject); child.on("exit", resolve); });
await log.close(); assert.equal(code, 0);
const completed = await store.get(job.id); assert.equal(completed.status, "READY", completed.error);
const result = completed.result, project = await loadProjectFile(job.projectId), plan = project.story;
assert.equal(result.validation.width, 1080); assert.equal(result.validation.height, 1920);
assert.ok(result.validation.duration >= 30 && result.validation.duration <= 45);
assert.ok(result.validation.fullDecode && result.validation.audioCodec === "aac" && result.validation.audioPeakDb > -30);
assert.equal(result.validation.blackIntervals.length, 0);
assert.equal(plan.subtitleCues.map(cue => cue.text).join(" "), input.narration);
assert.ok(plan.voice.endHoldSeconds >= 0.7 && plan.voice.naturalSpeed);
assert.ok(plan.narrationAlignment.coverage >= 0.8);
assert.equal(new Set(plan.scenes.map(scene => scene.visualCredit.id)).size, 6);
assert.ok(plan.scenes.every(scene => scene.visualCredit.license === "CC0-1.0" && scene.visualSelection.matchedTags.length));
const source = path.join(process.env.CLIPFORGE_STORAGE_DIR, result.relativePath);
const frameHashes = [];
for (const scene of plan.scenes) {
  const sample = path.join(directory, `scene-${scene.order}.jpg`);
  await runMedia("ffmpeg", ["-v", "error", "-y", "-ss", String(scene.startTime + scene.duration / 2), "-i", source, "-frames:v", "1", "-q:v", "3", sample]);
  frameHashes.push(await hashFile(sample));
}
assert.equal(new Set(frameHashes).size, 6);
const subtitles = await verifySubtitleFrame({ file: source, cue: selectSubtitleReviewCue(plan.subtitleCues), width: 1080, height: 1920, output: path.join(directory, "subtitle-review") });
const filename = path.join(directory, "lo-que-crece-en-silencio.mp4"); await copyFile(source, filename);
const evidence = { passed: true, testedAt: new Date().toISOString(), directory, storage: process.env.CLIPFORGE_STORAGE_DIR, jobId: job.id, projectId: job.projectId, filename, result, voice: plan.voice, alignment: plan.narrationAlignment, sceneCredits: plan.scenes.map(scene => ({ order: scene.order, narration: scene.narration, credit: scene.visualCredit, selection: scene.visualSelection })), subtitles, frameHashes, actualLocalNeuralTts: true, actualWhisper: true, actualExternalAI: false, publishing: "OFF", editorialApproval: "OWNER_REVIEW_REQUIRED" };
if (archive) {
  const library = new ClipLibraryService({ store: new R2ObjectStore({ config }) });
  const entry = await library.archive(project, project.clips[0]); assert.ok(entry);
  const bytes = await library.source(entry.id); const digest = createHash("sha256"); let length = 0;
  for await (const chunk of bytes.body) { digest.update(chunk); length += chunk.length; }
  assert.equal(digest.digest("hex"), await hashFile(source)); assert.equal(length, entry.sizeBytes);
  evidence.r2 = { ...entry, sha256: await hashFile(source), fullDownloadVerified: true };
}
const secondRaw = path.join(directory, "second-narration-original.wav"), secondUpload = path.join(directory, "second-narration-upload.wav");
await new LocalNeuralNarrationProvider().synthesize({ text: stories[1].scenes.join(" "), outputPath: secondRaw });
await runMedia("ffmpeg", ["-v", "error", "-y", "-i", secondRaw, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", secondUpload]);
evidence.secondNarration = { filename: secondUpload, duration: (await probeMediaFile(secondUpload)).duration, source: "Kokoro synthesis of second original script, uploaded as a recording fixture; not a human recording" };
await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
await writeFile(path.join(parent, "latest.json"), JSON.stringify({ directory }));
console.log(JSON.stringify({ passed: true, file: filename, duration: result.validation.duration, voice: evidence.voice, alignment: evidence.alignment, r2: Boolean(evidence.r2), evidence: path.join(directory, "evidence.json") }));
