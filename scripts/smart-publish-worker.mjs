import { runQueuedSmartPublishJob } from "../services/publishing/SmartPublishJobService.mjs";

console.log("ClipForge smart publish worker started.");

try {
  const result = await runQueuedSmartPublishJob();
  if (result.handled) {
    console.log("ClipForge smart publish worker handled job.", {
      status: result.job?.status || null,
      stage: result.job?.stage || null,
    });
  }
} catch (error) {
  console.error(
    "ClipForge smart publish worker failed:",
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
}

console.log("ClipForge smart publish worker stopped.");
