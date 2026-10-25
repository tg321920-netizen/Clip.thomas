import { LiveMonitorService } from "../services/live/LiveMonitorService.mjs";

const once = process.argv.includes("--once"), monitor = new LiveMonitorService();
let stopping = false;
process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; });
do {
  try {
    const state = await monitor.tick();
    console.info(JSON.stringify({ channel: "westcol", status: state.status, activeJobId: state.activeJobId || null, errorCode: state.errorCode || null, publication: "OFF" }));
    if (["DISABLED", "WAITING_RIGHTS_CONFIRMATION", "WAITING_PERSISTENT_STORAGE", "WAITING_LOCAL_ANALYSIS_PROVIDER"].includes(state.status)) break;
  } catch { console.error("No se pudo recuperar el checkpoint del monitor. Se detuvo para evitar capturas duplicadas."); process.exitCode = 1; break; }
  if (once || stopping) break;
  // Poll at most every 30 seconds; the ingest/media workers execute the jobs.
  for (let i = 0; i < 30 && !stopping; i++) await new Promise(resolve => setTimeout(resolve, 1000));
} while (!stopping);
