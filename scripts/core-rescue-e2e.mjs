// Real disk/HTTP/media acceptance for the upload service. The Next.js routes are
// verified separately by phase1:e2e and the deployed test; this is not Android.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { copyFile, mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ResumableUploadStore } from "../services/ingest/ResumableUploadStore.mjs";
import { IngestJobStore } from "../services/ingest/IngestJobStore.mjs";
import { ingestUrlJob } from "../services/ingest/UrlIngestService.mjs";
import { RenderService } from "../services/clip/RenderService.mjs";
import { validateMp4, runMedia } from "../services/media-processing/MediaValidationService.mjs";

const output = path.resolve(process.env.CLIPFORGE_E2E_OUTPUT || "artifacts/core-rescue");
const root = path.join(output, "storage"); await mkdir(root, { recursive: true });
process.env.CLIPFORGE_STORAGE_DIR = root;
const source = path.join(output, "authorized-test-source.mp4");
await runMedia("ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000", "-t", "3", "-c:v", "libx264", "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", source]);
// A valid MP4 free atom makes the transfer comparable to the reported 27 MB file.
const padded = await open(source, "a");
const free = Buffer.alloc(27 * 1024 * 1024); free.writeUInt32BE(free.length); free.write("free", 4); await padded.write(free); await padded.close();
const media = await readFile(source), uploads = new ResumableUploadStore(), jobs = new IngestJobStore();
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const parts = url.pathname.split("/").filter(Boolean); let result;
    if (parts[0] === "create") result = await uploads.create({ filename: "1000225709.mp4", mimeType: "video/mp4", size: media.length });
    else if (parts[0] === "chunk") result = await uploads.putChunk(parts[1], req.headers["x-upload-token"], Number(parts[2]), req, req.headers["x-chunk-sha256"]);
    else if (parts[0] === "status") result = await uploads.status(parts[1], req.headers["x-upload-token"]);
    else if (parts[0] === "finish") result = await uploads.finalize(parts[1], req.headers["x-upload-token"], input => jobs.enqueueUpload(input));
    else throw new Error("Unknown test route");
    res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(result));
  } catch (error) { res.writeHead(error.status || 500, { "Content-Type": "application/json" }); res.end(JSON.stringify({ code: error.code, error: error.message })); }
});
const serviceOnly = process.argv.includes("--service-only");
if (!serviceOnly) await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const base = serviceOnly ? "" : `http://127.0.0.1:${server.address().port}`;
const fetchJson = async (route, init) => {
  if (!serviceOnly) { const r = await fetch(base + route, init); return { response: r, value: await r.json() }; }
  const [, action, id, index] = route.split("/");
  try {
    const token = init.headers?.["X-Upload-Token"]; let value;
    if (action === "create") value = await uploads.create({ filename: "1000225709.mp4", mimeType: "video/mp4", size: media.length });
    else if (action === "chunk") value = await uploads.putChunk(id, token, Number(index), [init.body], init.headers["X-Chunk-SHA256"]);
    else if (action === "status") value = await uploads.status(id, token);
    else value = await uploads.finalize(id, token, input => jobs.enqueueUpload(input));
    return { response: { status: 200 }, value };
  } catch (error) { return { response: { status: error.status || 500 }, value: { code: error.code, error: error.message } }; }
};
let report;
try {
  const { value: session } = await fetchJson("/create", { method: "POST" });
  const token = { "X-Upload-Token": session.token };
  for (let i = 0; i < session.chunkCount; i++) {
    const data = media.subarray(i * session.chunkSize, Math.min(media.length, (i + 1) * session.chunkSize));
    const hash = createHash("sha256").update(data).digest("hex");
    if (i === 1) {
      const interrupted = await fetchJson(`/chunk/${session.id}/${i}`, { method: "PUT", headers: { ...token, "X-Chunk-SHA256": hash }, body: data.subarray(0, 500) });
      assert.equal(interrupted.value.code, "CHUNK_INCOMPLETE");
      assert.deepEqual((await fetchJson(`/status/${session.id}`, { headers: token })).value.received, [0]);
    }
    const result = await fetchJson(`/chunk/${session.id}/${i}`, { method: "PUT", headers: { ...token, "X-Chunk-SHA256": hash }, body: data });
    assert.equal(result.response.status, 200, result.value.error);
    if (i === 0) assert.equal((await fetchJson(`/chunk/${session.id}/${i}`, { method: "PUT", headers: { ...token, "X-Chunk-SHA256": hash }, body: data })).value.duplicate, true);
  }
  assert.equal((await fetchJson(`/finish/${session.id}`, { method: "POST", headers: token })).response.status, 200);
  assert.equal((await fetchJson(`/finish/${session.id}`, { method: "POST", headers: token })).response.status, 200);
  // Re-create worker store to prove processing does not depend on the HTTP client.
  const recovered = new IngestJobStore(); const job = await recovered.claimNext(); assert.equal(job.id, session.id);
  const result = await ingestUrlJob(job); await recovered.complete(job, result);
  const project = { id: result.projectId, source: { ...result.video, relativePath: path.posix.join("uploads", result.projectId, result.video.storedName) } };
  const clip = { id: randomUUID(), startTime: 0, duration: 3, edit: { quality: "FAST", framingMode: "FIT" } };
  const render = await new RenderService({ width: 360, height: 640 }).renderClip({ project, clip });
  const finalPath = path.join(output, "first-validated.mp4"); await copyFile(path.join(root, render.relativePath), finalPath);
  const validation = await validateMp4(finalPath, { requireAudio: true, duration: 3, width: 360, height: 640 });
  report = { passed: true, testClient: serviceOnly ? "Disk service integration; HTTP, Android and deployed Next routes pending" : "Node HTTP loopback using the real upload store; Android and deployed Next routes pending", uploadBytes: media.length, interruptedAndResumed: true, duplicates: true, workerRestart: true, file: finalPath, validation };
  await writeFile(path.join(output, "evidence.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { if (!serviceOnly) await new Promise(resolve => server.close(resolve)); }
