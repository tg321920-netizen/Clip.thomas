import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";

// One worker scope reaches existing FFmpeg, TTS, Whisper and HTTP adapters
// without changing every service's public rendering signature.
const execution = new AsyncLocalStorage();
export const withMediaExecution = (signal, operation, onSpawn) => execution.run({ signal, onSpawn }, operation);
export function mediaExecutionSignal(explicit) {
  const scoped = execution.getStore()?.signal;
  return scoped && explicit && scoped !== explicit ? AbortSignal.any([scoped, explicit]) : scoped || explicit;
}

export function spawnMediaProcess(command, args, options = {}) {
  const { signal: explicit, ...settings } = options;
  const signal = mediaExecutionSignal(explicit);
  signal?.throwIfAborted();
  if (!signal) return spawn(command, args, settings);
  const grouped = process.platform !== "win32";
  const child = spawn(command, args, { ...settings, detached: grouped });
  const onSpawn = execution.getStore()?.onSpawn;
  let timer;
  const kill = name => {
    if (!child.pid) return;
    try { if (grouped) process.kill(-child.pid, name); else child.kill(name); }
    catch (error) { if (error.code !== "ESRCH") child.kill(name); }
  };
  const stop = () => { kill("SIGTERM"); timer ||= setTimeout(() => kill("SIGKILL"), 1500); timer.unref(); };
  signal.addEventListener("abort", stop, { once: true });
  child.once("spawn", () => { onSpawn?.({ pid: child.pid, encoder: args.includes("libx264") }); if (signal.aborted) stop(); });
  child.once("close", () => { clearTimeout(timer); signal.removeEventListener("abort", stop); });
  if (signal.aborted) stop();
  return child;
}
