import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { withMediaExecution, spawnMediaProcess } from "../lib/media-execution.mjs";
import { runMedia } from "../services/media-processing/MediaValidationService.mjs";
import { requestStructuredJson, resolveOpenAICompatibleConfig } from "../services/ai/OpenAICompatibleClient.mjs";

test("cancellation kills a native child that ignores graceful termination", { timeout: 10000 }, async () => {
  const controller = new AbortController();
  const child = withMediaExecution(controller.signal, () => spawnMediaProcess(process.execPath, ["-e", "process.on('SIGTERM',()=>{});console.log('READY');setInterval(()=>{},1000)"], { stdio: ["ignore", "pipe", "pipe"] }));
  try {
    await once(child.stdout, "data"); const closed = once(child, "close"); controller.abort(new Error("user cancelled"));
    const [code, signal] = await closed; assert.equal(code, null); assert.equal(signal, "SIGKILL");
    assert.throws(() => process.kill(child.pid, 0), { code: "ESRCH" });
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL"); }
});

test("the worker's cancellation aborts an actual HTTP provider request", { timeout: 10000 }, async () => {
  let received; const incoming = new Promise(resolve => { received = resolve; });
  const server = createServer((request, response) => { request.resume(); received(); response.on("error", () => {}); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const controller = new AbortController();
  try {
    const config = resolveOpenAICompatibleConfig({ apiKey: "local-test-only", baseUrl: `http://127.0.0.1:${server.address().port}/v1`, model: "fixture", apiStyle: "chat-completions", timeoutMs: 30000 });
    const request = withMediaExecution(controller.signal, () => requestStructuredJson({ config, name: "cancel_test", schema: { type: "object" }, instructions: "Return JSON for a local cancellation test", input: { prompt: "fixture" } }));
    const rejected = assert.rejects(request, error => error.code === "MEDIA_CANCELLED");
    await incoming; controller.abort(Object.assign(new Error("cancelled"), { code: "MEDIA_CANCELLED" })); await rejected;
  } finally { controller.abort(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test("real FFmpeg stops during an active encode and cannot report success", { skip: process.env.CLIPFORGE_RUN_MEDIA_TESTS !== "true", timeout: 15000 }, async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "clipforge-cancel-ffmpeg-"));
  const controller = new AbortController(); let ready;
  const started = new Promise(resolve => { ready = resolve; });
  try {
    const render = withMediaExecution(controller.signal, () => runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-re", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=30", "-t", "60", "-an", "-c:v", "libx264", "-threads", "1", "-progress", "pipe:1", path.join(directory, "partial.mp4")], { onStdout: text => { if (/frame=\d+/.test(text)) ready(); } }));
    const rejected = assert.rejects(render, { code: "MEDIA_CANCELLED" });
    await started; controller.abort(Object.assign(new Error("cancelled active FFmpeg"), { code: "MEDIA_CANCELLED" })); await rejected;
  } finally { controller.abort(); await rm(directory, { recursive: true, force: true }); }
});
