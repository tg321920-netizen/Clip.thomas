// Opt-in real provider and R2 validation. Default mode stays entirely local.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { AgentRuntimeService } from "../services/agent/AgentRuntimeService.mjs";
import { resolveZaiConfig } from "../services/agent/providers/ZaiAgentProvider.mjs";
import { JobStore } from "../services/JobStore.mjs";
import { BestClipsService } from "../services/analysis/BestClipsService.mjs";
import { TranscriptCandidateProvider } from "../services/analysis/TranscriptCandidateProvider.mjs";
import { measureAudioEnergy, measureSceneChanges, sentenceSegments } from "../services/analysis/AudioEnergyService.mjs";
import { AIUsageService } from "../services/usage/AIUsageService.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
import { ClipLibraryService } from "../services/storage/ClipLibraryService.mjs";
import { R2ObjectStore, readR2Config } from "../services/storage/R2ObjectStore.mjs";
import { hashFile } from "../services/ingest/ResumableUploadStore.mjs";
import { selectSubtitleReviewCue, verifySubtitleFrame } from "./verify-subtitle-frame.mjs";

const realAI = process.argv.includes("--real-ai"), archive = process.argv.includes("--r2");
const r2Config = archive ? readR2Config() : null;
const config = realAI ? resolveZaiConfig() : null;
if (realAI && (config.model !== "glm-4.6v-flash" || config.baseUrl !== "https://api.z.ai/api/paas/v4" || process.env.CLIPFORGE_EDITOR_MODEL !== "glm-4.6v-flash")) throw new Error("This acceptance permits only the explicitly selected free Z.ai model.");
if (archive && !r2Config) throw new Error("R2 is not configured; no cloud validation was performed.");
const latest = process.env.CLIPFORGE_LANGUAGE_FIXTURE_DIR ? { directory: process.env.CLIPFORGE_LANGUAGE_FIXTURE_DIR } : JSON.parse(await readFile("artifacts/editor-languages/latest.json", "utf8"));
const languageEvidence = JSON.parse(await readFile(path.join(latest.directory, "evidence.json"), "utf8"));
assert.deepEqual(languageEvidence.languages.map(item => item.language).sort(), ["en", "es"], "Both language transcriptions must finish before reviewing clips");
const directory = path.join(latest.directory, `${realAI ? "real-ai" : "heuristic"}-${randomUUID()}`);
await mkdir(directory, { recursive: true });
process.env.CLIPFORGE_STORAGE_DIR = path.join(latest.directory, "storage");
Object.assign(process.env, { CLIPFORGE_MEDIA_STORAGE_PROVIDER: "local", CLIPFORGE_MEDIA_WIDTH: "360", CLIPFORGE_MEDIA_HEIGHT: "640" });
for (const name of ["CLIPFORGE_REDIS_URL", "REDIS_URL"]) delete process.env[name];
for (const name of ["CLIPFORGE_AGENT_ENABLED", "CLIPFORGE_AGENT_REAL_PUBLISHING", "CLIPFORGE_CONTENT_REAL_PUBLISHING", "CLIPFORGE_SMART_PUBLISH_ON_BOOT"]) process.env[name] = "false";
const evidence = { testedAt: new Date().toISOString(), directory, storage: process.env.CLIPFORGE_STORAGE_DIR, actualExternalAI: realAI, model: realAI ? config.model : "NONE_HEURISTIC", publishing: "OFF", languages: [] };
const safe = value => String(value || "").split(config?.apiKey || "\u0000").join("[REDACTED]").slice(0, 600);
const store = new JobStore();
for (const source of languageEvidence.languages) {
  const project = await loadProjectFile(source.projectId), outputId = randomUUID();
  const input = { projectId: source.projectId, count: 5, minDuration: 25, maxDuration: 35, targetDuration: 30, subtitles: true, contentProfile: "PODCAST", analysisProvider: "heuristic" };
  const item = { language: source.language, sourceProjectId: source.projectId, requestedCount: 5 };
  evidence.languages.push(item);
  const start = performance.now();
  try {
    let result;
    if (realAI) {
      const runtime = new AgentRuntimeService();
      const execution = await runtime.createTask({ objective: "Prepara hasta cinco clips distintos de unos treinta segundos del proyecto propio seleccionado usando clips.prepare y task.context.clipping. No publiques. Informa el trabajo real encolado.", projectId: source.projectId, autonomyMode: "SEMI_AUTO", context: { clipping: { count: 5, duration: 30, contentProfile: "PODCAST", rightsConfirmed: true } }, limits: { maxSteps: 4, maxRetries: 1, timeoutMs: 120000 } });
      let state = await runtime.runExecution(execution.id);
      if (state.status === "WAITING_RETRY") {
        await new Promise(resolve => setTimeout(resolve, Math.max(0, Math.min(10000, Date.parse(state.nextAttemptAt) - Date.now()))));
        state = await runtime.runExecution(execution.id);
      }
      item.executionId = execution.id; item.planningStatus = state.status;
      const prepared = state.results.find(entry => entry.tool === "clips.prepare")?.result;
      if (!prepared) throw new Error(safe(state.error || state.pendingDecision?.reason || "The agent did not enqueue a clip job."));
      item.jobId = prepared.jobId;
      const log = createWriteStream(path.join(directory, `${source.language}-worker.log`));
      const code = await new Promise((resolve, reject) => { const child = spawn(process.execPath, ["scripts/media-worker.mjs", "--once"], { env: process.env, stdio: ["ignore", log, log] }); child.on("error", reject); child.on("exit", resolve); });
      log.end(); assert.equal(code, 0);
      const job = await store.get(prepared.jobId); item.jobStatus = job.status;
      if (job.status !== "READY") throw new Error(safe(job.error || `Job status: ${job.status}`));
      result = job.result;
    } else {
      const job = await store.enqueueMedia("MEDIA_CLIPS", outputId, input);
      result = await new BestClipsService().render(outputId, input);
      await store.complete({ ...job, result, validation: result.validation });
      item.jobId = job.id;
    }
    const rendered = await loadProjectFile(result.projectId);
    assert.ok(result.clips.length > 0 && result.clips.length <= 5);
    assert.ok(result.clips.every(clip => clip.duration >= 25 && clip.duration <= 35 && clip.validation.valid && clip.validation.fullDecode));
    for (let a = 0; a < result.clips.length; a++) for (let b = a + 1; b < result.clips.length; b++) assert.ok(Math.min(result.clips[a].endTime, result.clips[b].endTime) <= Math.max(result.clips[a].startTime, result.clips[b].startTime));
    const first = rendered.clips[0];
    const subtitles = await verifySubtitleFrame({ file: path.join(process.env.CLIPFORGE_STORAGE_DIR, first.render.relativePath), cue: selectSubtitleReviewCue(first.subtitles.cues), width: 360, height: 640, output: path.join(directory, `${source.language}-subtitle`) });
    const energy = await measureAudioEnergy(path.join(process.env.CLIPFORGE_STORAGE_DIR, project.source.relativePath));
    const scenes = await measureSceneChanges(path.join(process.env.CLIPFORGE_STORAGE_DIR, project.source.relativePath));
    item.profileChecks = {};
    for (const contentProfile of ["GAMING", "PODCAST", "ENTERTAINMENT", "NEWS", "MOTIVATION"]) {
      const candidates = await new TranscriptCandidateProvider().analyze({ transcript: { ...project.transcript, segments: sentenceSegments(project.transcript.segments) }, audioEnergyWindows: energy, sceneChanges: scenes, options: { ...input, contentProfile, maxCandidates: 5, requireCompleteSentences: true } });
      item.profileChecks[contentProfile] = { actualCandidates: candidates.length, sampleReason: candidates[0]?.reason, scope: "Actual transcript/signals; no real-world editorial accuracy benchmark" };
    }
    assert.equal(await hashFile(path.join(process.env.CLIPFORGE_STORAGE_DIR, project.source.relativePath)), source.sourceSha256);
    Object.assign(item, { status: "READY", actualCount: result.clips.length, resultProjectId: result.projectId, warnings: result.warnings, clips: result.clips, subtitles, elapsedSeconds: (performance.now() - start) / 1000, usage: await new AIUsageService().summarize({ projectId: source.projectId }) });
    if (archive) {
      const library = new ClipLibraryService({ store: new R2ObjectStore({ config: r2Config }) });
      first.title = `Prueba bilingüe propia ${source.language} (${realAI ? "Z.ai real" : "selección heurística"})`;
      const saved = await library.archive(rendered, first);
      const localHash = await hashFile(path.join(process.env.CLIPFORGE_STORAGE_DIR, first.render.relativePath));
      const downloaded = await library.source(saved.id);
      const digest = createHash("sha256"); let bytes = 0;
      for await (const chunk of downloaded.body) { digest.update(chunk); bytes += chunk.length; }
      assert.equal(digest.digest("hex"), localHash); assert.equal(bytes, saved.sizeBytes);
      const ranged = await library.source(saved.id, "bytes=0-1023"); let rangeBytes = 0;
      for await (const chunk of ranged.body) rangeBytes += chunk.length;
      assert.equal(rangeBytes, 1024);
      item.r2 = { id: saved.id, private: true, sha256: localHash, bytes, rangeBytes, expiresAt: saved.expiresAt, keep: saved.keep };
    }
  } catch (error) {
    item.status = "BLOCKED"; item.error = safe(error.message);
    if (!realAI) { await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2)); throw error; }
  }
  await writeFile(path.join(directory, "evidence.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ language: item.language, status: item.status, actualCount: item.actualCount, error: item.error, evidence: path.join(directory, "evidence.json") }));
  if (realAI && item.status === "BLOCKED") break;
}
if (realAI && evidence.languages.some(item => item.status === "BLOCKED")) process.exitCode = 2;
