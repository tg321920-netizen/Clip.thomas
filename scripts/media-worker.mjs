import { JobStore } from "../services/JobStore.mjs";
import { loadProjectFile } from "../lib/project-files.mjs";
import { SceneStoryService } from "../services/owned-content/SceneStoryService.mjs";
import { VideoAutoEditService } from "../services/autoedit/VideoAutoEditService.mjs";
import { BestClipsService } from "../services/analysis/BestClipsService.mjs";
import { recoverMediaResult } from "../services/media-processing/MediaResultRecovery.mjs";
import { ResumableUploadStore } from "../services/ingest/ResumableUploadStore.mjs";
import { cleanupCompletedMedia } from "../services/media-processing/MediaTempCleanup.mjs";
const store = new JobStore(), once = process.argv.includes("--once"); let stopping = false;
process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
while (!stopping) {
  await new ResumableUploadStore().cleanup();
  for(const completed of await store.listMedia())await cleanupCompletedMedia(completed).catch(error=>console.error("Media temporary cleanup:",error.message));
  const job = await store.claimNext(["MEDIA_STORY", "MEDIA_EDIT", "MEDIA_CLIPS"]);
  if (!job) { if (once) break; await new Promise(r => setTimeout(r, 2500)); continue; }
  const heartbeat = setInterval(() => { void store.heartbeat(job.id).catch(() => {}); }, 15_000);
  try {
    // A crash after persisting the validated project need not render it again.
    const existing = await loadProjectFile(job.projectId);
    let result = await recoverMediaResult(existing, job);
    if (!result) {
      const service = job.type === "MEDIA_STORY" ? new SceneStoryService() : job.type === "MEDIA_EDIT" ? new VideoAutoEditService() : new BestClipsService();
      result = await service.render(job.projectId, job.payload, async (status, stage, progress) => store.transition(job.id, status, stage, progress));
    }
    const completed=await store.complete({ ...(await store.get(job.id)), result, resultPath: result.relativePath || null, validation: result.validation });
    await cleanupCompletedMedia(completed).catch(error=>console.error("Media temporary cleanup:",error.message));
  } catch (error) {
    if (error.code === "WAITING_RESOURCE") {
      await store.transition(job.id, "WAITING_RESOURCE", "WAITING_RESOURCE", null, { error: error.message }); await store.release(job.id);
    } else await store.fail({ ...(await store.get(job.id)) }, error, { retryable: false });
  } finally { clearInterval(heartbeat); }
  if (once) break;
}

