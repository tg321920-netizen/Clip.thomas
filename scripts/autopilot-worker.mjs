import { listProjectFiles } from "../lib/project-files.mjs";
import { AutopilotService } from "../services/autopilot/AutopilotService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  1000,
  Number(process.env.CLIPFORGE_AUTOPILOT_POLL_MS || 10000),
);
const service = new AutopilotService();

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });

console.log("ClipForge Autopilot worker started.");

while (!stopping) {
  try {
    const config = await service.getConfig();

    if (config.enabled && config.mode === "AUTOPILOT") {
      const projects = await listProjectFiles(200);

      for (const project of projects) {
        if (stopping) break;

        try {
          const result = await service.advanceProject(project.id, { config });

          if (result.queuedJob) {
            console.log("Autopilot advanced project", {
              projectId: project.id,
              state: result.state,
              jobId: result.queuedJob.id,
            });
          }
        } catch (error) {
          console.error("Autopilot project advance failed", {
            projectId: project.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    console.error("Autopilot worker cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (once) break;
  await sleep(pollMs);
}

console.log("ClipForge Autopilot worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
