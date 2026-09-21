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
  const job = await store.claimNext();

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

  try {
    if (job.type !== "TRANSCRIBE_VIDEO") {
      throw new Error(`Unsupported job type: ${job.type}`);
    }

    const result = await transcribeProject(job.projectId);
    await store.complete(job);

    console.log("Transcription completed", {
      projectId: job.projectId,
      reused: result.reused,
      segments: result.transcript?.segments?.length ?? 0,
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
  }

  if (once) break;
}

console.log("ClipForge transcription worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
