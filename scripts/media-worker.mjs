import { JobStore } from "../services/JobStore.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
import { SceneStoryService } from "../services/owned-content/SceneStoryService.mjs";
import { VideoAutoEditService } from "../services/autoedit/VideoAutoEditService.mjs";
import { BestClipsService } from "../services/analysis/BestClipsService.mjs";
import { recoverMediaResult } from "../services/media-processing/MediaResultRecovery.mjs";
import { ResumableUploadStore } from "../services/ingest/ResumableUploadStore.mjs";
import { cleanupCompletedMedia } from "../services/media-processing/MediaTempCleanup.mjs";
import { withMediaExecution } from "../lib/media-execution.mjs";
import { releasePolicy } from "../lib/release-policy.mjs";
const store = new JobStore(), once = process.argv.includes("--once"); let stopping = false;
let activeController = null;
const stop = () => { stopping = true; activeController?.abort(Object.assign(new Error("El procesador se está reiniciando."), { code: "MEDIA_INTERRUPTED" })); };
process.on("SIGTERM", stop); process.on("SIGINT", stop);
while (!stopping) {
  await new ResumableUploadStore().cleanup();
  for(const completed of await store.listMedia())await cleanupCompletedMedia(completed).catch(error=>console.error("Media temporary cleanup:",error.message));
  const job = await store.claimNext(releasePolicy().features.stories ? ["MEDIA_STORY", "MEDIA_EDIT", "MEDIA_CLIPS"] : ["MEDIA_EDIT", "MEDIA_CLIPS"]);
  if (!job) { if (once) break; await new Promise(r => setTimeout(r, 2500)); continue; }
  const startedAt = Date.now();
  const controller = new AbortController(); activeController = controller;
  let checking = false;
  const checkCancellation = async () => {
    if (checking || controller.signal.aborted) return;
    checking = true;
    try {
      const fresh = await store.get(job.id);
      if (!fresh || fresh.status === "CANCELLED" || fresh.generation !== job.generation) controller.abort(Object.assign(new Error("Trabajo cancelado por el usuario."), { code: "MEDIA_CANCELLED" }));
    } catch (error) { controller.abort(error); }
    finally { checking = false; }
  };
  const cancellationTimer = setInterval(() => void checkCancellation(), 250); cancellationTimer.unref();
  let stageStartedAt = startedAt, previousStage = "WAITING_TO_START";
  const logStage = async (status, stage, progress) => {
    await checkCancellation(); controller.signal.throwIfAborted();
    const now = Date.now();
    if (stage !== previousStage) {
      console.info("[media-timing]", { jobId: job.id, type: job.type, stage: previousStage, elapsedMs: now - stageStartedAt, totalMs: now - startedAt });
      stageStartedAt = now;
      previousStage = stage;
    }
    const updated = await store.transition(job.id, status, stage, progress);
    if (updated?.status === "CANCELLED") { await checkCancellation(); controller.signal.throwIfAborted(); }
    return updated;
  };
  const heartbeat = setInterval(() => { void store.heartbeat(job.id).catch(() => {}); }, 15_000);
  try {
    await withMediaExecution(controller.signal, async () => {
    await checkCancellation(); controller.signal.throwIfAborted();
    // A crash after persisting the validated project need not render it again.
    const existing = await loadProjectFile(job.projectId);
    let result = await recoverMediaResult(existing, job);
    if (!result) {
      const service = job.type === "MEDIA_STORY" ? new SceneStoryService() : job.type === "MEDIA_EDIT" ? new VideoAutoEditService() : new BestClipsService();
      result = await service.render(job.projectId, job.payload, logStage);
    }
    controller.signal.throwIfAborted();
    const completed=await store.complete({ ...(await store.get(job.id)), generation: job.generation, result, resultPath: result.relativePath || null, validation: result.validation });
    await cleanupCompletedMedia(completed).catch(error=>console.error("Media temporary cleanup:",error.message));
    }, record => console.info("[media-native]", JSON.stringify({ jobId: job.id, ...record })));
  } catch (error) {
    if (controller.signal.reason?.code === "JOB_METADATA_INVALID" || error.code === "JOB_METADATA_INVALID") {
      await store.release(job.id); console.error("Media job metadata needs recovery:", job.id);
    } else if (controller.signal.reason?.code === "MEDIA_INTERRUPTED") {
      await store.interruptMedia(job);
    } else if (controller.signal.aborted) {
      await store.fail(job, controller.signal.reason, { retryable: false });
    } else if (error.code === 'STATE_BUSY' || error.code === 'RENDER_CAPACITY_BUSY') {
      await store.fail({...job,attempts:Math.max(0,job.attempts-1)},error,{retryable:true});
    } else if (error.code === "WAITING_RESOURCE") {
      await store.transition(job.id, "WAITING_RESOURCE", "WAITING_RESOURCE", null, { error: error.message }); await store.release(job.id);
    } else await store.fail(job, error, { retryable: false });
  } finally {
    console.info("[media-timing]", { jobId: job.id, type: job.type, stage: previousStage, elapsedMs: Date.now() - stageStartedAt, totalMs: Date.now() - startedAt });
    clearInterval(heartbeat);
    clearInterval(cancellationTimer); activeController = null;
  }
  if (once) break;
}

