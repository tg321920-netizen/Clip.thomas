import { AnalyticsCollectorService } from "../services/analytics/AnalyticsCollectorService.mjs";

const once = process.argv.includes("--once");
const pollMs = Math.max(
  60_000,
  Number(process.env.CLIPFORGE_ANALYTICS_POLL_MS || 15 * 60 * 1000),
);
const minAgeMs = Math.max(
  60_000,
  Number(process.env.CLIPFORGE_ANALYTICS_REFRESH_MS || 60 * 60 * 1000),
);

const collector = new AnalyticsCollectorService();
let stopping = false;

process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});

console.log("ClipForge analytics worker started.");

while (!stopping) {
  try {
    const results = await collector.collectPublished({ minAgeMs, limit: 50 });
    const collected = results.filter((result) => result.collected).length;
    const failed = results.filter(
      (result) => result.reason === "PROVIDER_REQUEST_FAILED",
    ).length;

    if (results.length > 0) {
      console.log("Analytics collection cycle completed", {
        checked: results.length,
        collected,
        failed,
      });
    }
  } catch (error) {
    console.error("Analytics collection cycle failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (once) break;
  await sleep(pollMs);
}

console.log("ClipForge analytics worker stopped.");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
