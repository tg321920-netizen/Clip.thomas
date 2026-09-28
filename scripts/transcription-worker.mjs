import { JobStore } from "../services/JobStore.mjs";
import { transcribeProject } from "../services/transcription/TranscriptionService.mjs";

const once = process.argv.includes("--once");
const pollMs = Number(process.env.CLIPFORGE_WORKER_POLL_MS || 2000);
const store = new JobStore();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge transcription worker started.");

while (!stopping) {
  const job = await store.claimNext(["TRANSCRIBE_VIDEO"]);

  if (!job) {
    if (once) break;
    await sleep(pollMs);
    continue;
  }

  console.log("Processing job", {
    id: job.id,
    type: job.type,
    projectId: job.projectId,
    attempt: job.attempts,
  });

  const heartbeat = setInterval(() => {
    void store.heartbeat(job.id).catch((error) =>
      console.warn("Transcription heartbeat failed", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }, 15_000);
  heartbeat.unref?.();

  try {
    const result = await transcribeProject(job.projectId, {
      ...(job.payload || {}),
      onProgress: async (progress) => {
        await store.updateProgress(job.id, progress);
        await store.heartbeat(job.id);
      },
    });
    await store.complete(job);

    console.log("Transcription completed", {
      projectId: job.projectId,
      reused: result.reused,
      segments: result.transcript?.segments?.length ?? 0,
      chunks: result.transcript?.chunks?.length ?? 1,
    });
  } catch (error) {
    const failed = await store.fail(job, error);
    console.error("Transcription job failed", {
      projectId: job.projectId,
      status: failed.status,
      attempts: failed.attempts,
      error: failed.error,
      nextAttemptAt: failed.nextAttemptAt,
    });
  } finally {
    clearInterval(heartbeat);
  }

  if (once) break;
}

console.log("ClipForge transcription worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
