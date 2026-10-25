// Original synthetic speech; actual Whisper inference. No external AI or media.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { EspeakNewsTtsProvider } from "../services/news/EspeakNewsTtsProvider.mjs";
import { WhisperCppProvider } from "../services/transcription/WhisperCppProvider.mjs";
import { transcribeProject } from "../services/transcription/TranscriptionService.mjs";
import { probeMediaFile, runMedia } from "../services/media-processing/MediaValidationService.mjs";
import { loadProjectFile, replaceProjectFile } from "../lib/project-files.mjs";
import { hashFile } from "../services/ingest/ResumableUploadStore.mjs";

const parent = path.resolve("artifacts/editor-languages");
await mkdir(parent, { recursive: true });
const directory = await mkdtemp(path.join(parent, "run-"));
process.env.CLIPFORGE_STORAGE_DIR = path.join(directory, "storage");
process.env.WHISPER_WORD_TIMESTAMPS = "true";
for (const key of ["CLIPFORGE_REDIS_URL", "REDIS_URL"]) delete process.env[key];
for (const key of ["CLIPFORGE_AGENT_REAL_PUBLISHING", "CLIPFORGE_CONTENT_REAL_PUBLISHING", "CLIPFORGE_SMART_PUBLISH_ON_BOOT", "CLIPFORGE_AGENT_ENABLED"]) process.env[key] = "false";
const scripts = JSON.parse(await readFile(new URL("./fixtures/editor-language-narrations.json", import.meta.url), "utf8"));
const evidence = { testedAt: new Date().toISOString(), directory, publishing: "OFF", source: "Original synthetic speech and test pattern; not human speech or a real streamer", actualWhisper: true, actualExternalAI: false, languages: [] };
await writeFile(path.join(parent, "latest.json"), JSON.stringify({ directory }));
for (const language of ["es", "en"]) {
  const id = randomUUID(), relativePath = `uploads/${id}/source.mp4`;
  const upload = path.join(process.env.CLIPFORGE_STORAGE_DIR, "uploads", id);
  await mkdir(upload, { recursive: true });
  const text = scripts[language].join(" ");
  const audio = path.join(upload, "original.wav"), source = path.join(upload, "source.mp4");
  await new EspeakNewsTtsProvider({ voice: language, speed: 135 }).synthesize({ text, outputPath: audio });
  await runMedia("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=10", "-i", audio, "-shortest", "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", source]);
  const info = await probeMediaFile(source), sourceSha256 = await hashFile(source);
  await replaceProjectFile(id, { id, createdAt: new Date().toISOString(), source: { projectId: id, originalName: `own-${language}-narration.mp4`, relativePath, sizeBytes: (await stat(source)).size, durationSeconds: info.duration, width: 640, height: 360, hasAudio: true }, clips: [] });
  const start = performance.now();
  await transcribeProject(id, { provider: new WhisperCppProvider({ language: "auto" }) });
  const elapsedSeconds = (performance.now() - start) / 1000;
  const project = await loadProjectFile(id), transcript = project.transcript;
  assert.equal(transcript.status, "COMPLETED");
  assert.equal(transcript.language, language, "Whisper must detect the fixture language without being given its reference text");
  assert.ok(transcript.segments.length > 0);
  assert.ok(transcript.segments.every(s => s.startTime >= 0 && s.endTime <= info.duration && s.endTime > s.startTime));
  assert.equal(await hashFile(source), sourceSha256);
  const quality = wordErrorRate(text, transcript.text);
  const entry = { language, detectedLanguage: transcript.language, languageDetectionCorrect: transcript.language === language, projectId: id, originalDuration: info.duration, sourceSha256, provider: transcript.provider, model: transcript.model, elapsedSeconds, realTimeFactor: elapsedSeconds / info.duration, segments: transcript.segments.length, wordsWithMeasuredTiming: transcript.segments.reduce((sum, s) => sum + (s.words?.length || 0), 0), ...quality, translation: "NOT_IMPLEMENTED_IN_CLIPPING", dubbing: "NOT_IMPLEMENTED_IN_CLIPPING" };
  evidence.languages.push(entry);
  await writeFile(path.join(directory, `${language}-reference.txt`), text);
  await writeFile(path.join(directory, `${language}-transcript.txt`), transcript.text);
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(entry));
}
console.log(`Language evidence: ${directory}`);

function wordErrorRate(reference, hypothesis) {
  const words = value => String(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  const expected = words(reference), actual = words(hypothesis);
  let previous = Array.from({ length: actual.length + 1 }, (_, i) => i);
  for (let i = 1; i <= expected.length; i++) {
    const row = [i];
    for (let j = 1; j <= actual.length; j++) row[j] = Math.min(previous[j] + 1, row[j - 1] + 1, previous[j - 1] + Number(expected[i - 1] !== actual[j - 1]));
    previous = row;
  }
  return { referenceWords: expected.length, recognizedWords: actual.length, editDistance: previous[actual.length], wordErrorRate: previous[actual.length] / Math.max(1, expected.length), normalization: "lowercase, remove accents and punctuation; no semantic correction" };
}
