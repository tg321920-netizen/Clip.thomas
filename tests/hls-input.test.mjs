import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { openHlsInput } from "../services/ingest/HlsInputService.mjs";
import { captureSegmentedStream } from "../services/ingest/UrlIngestService.mjs";
import { runMedia, validateMp4, probeMediaFile } from "../services/media-processing/MediaValidationService.mjs";

async function fixture({ body = Buffer.alloc(256, 42), bodies, segmentDuration = 12, encrypted = false, redirect = false, privateUri = false } = {}) {
  const rootPath = `/master.m3u8?ticket=${"a".repeat(9000)}END`;
  const mediaPath = `/media.m3u8?ticket=${"b".repeat(6000)}END`;
  const segmentPath = `/piece.ts?ticket=${"c".repeat(7000)}END`;
  const resources = bodies || [body];
  const segmentPaths = resources.map((_, i) => i ? `/piece-${i}.ts?ticket=${"c".repeat(7000)}END` : segmentPath);
  const requests = []; let origin;
  const server = http.createServer({ maxHeaderSize: 32768 }, (req, res) => {
    requests.push({ length: req.url.length, complete: req.url.endsWith("END"), range: req.headers.range, segmentIndex: segmentPaths.indexOf(req.url) });
    if (req.url === rootPath) {
      if (redirect) { res.writeHead(302, { Location: "http://127.0.0.2/private" }); res.end(); return; }
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.end(`#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=64x64\n${mediaPath}\n`); return;
    }
    if (req.url === mediaPath) {
      res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
      res.end(`#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:${segmentDuration}\n#EXT-X-MEDIA-SEQUENCE:0\n${encrypted ? '#EXT-X-KEY:METHOD=AES-128,URI="/private.key"\n' : ""}#EXT-X-PROGRAM-DATE-TIME:2026-10-25T17:00:00Z\n${segmentPaths.map(p => `#EXTINF:${segmentDuration},\n${privateUri ? "http://127.0.0.2/private" : p}`).join('\n')}\n#EXT-X-ENDLIST\n`); return;
    }
    if (segmentPaths.includes(req.url)) {
      const body = resources[segmentPaths.indexOf(req.url)];
      const range = /^bytes=(\d+)-(\d*)$/u.exec(req.headers.range || "");
      if (range) {
        const start = Number(range[1]), end = Math.min(body.length - 1, Number(range[2] || body.length - 1));
        res.writeHead(206, { "Content-Type": "video/mp2t", "Content-Range": `bytes ${start}-${end}/${body.length}`, "Content-Length": end - start + 1 });
        res.end(body.subarray(start, end + 1));
      } else { res.writeHead(200, { "Content-Type": "video/mp2t", "Content-Length": body.length }); res.end(body); }
      return;
    }
    res.writeHead(400); res.end("The complete fixture request target is required.");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const validateUrl = async raw => { const u = new URL(raw); if (u.origin !== origin) throw new Error("Fixture origin only"); return u.toString(); };
  return { source: origin + rootPath, requests, validateUrl, request: fetch,
    close: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
async function childUrl(url) {
  const text = await (await fetch(url)).text();
  return text.split("\n").find(line => line && !line.startsWith("#"));
}

test("HLS input preserves long publisher URLs, forwards byte ranges and never reports private paths", async () => {
  const f = await fixture(); const events = []; let input;
  try {
    input = await openHlsInput(f.source, { validateUrl: f.validateUrl, request: f.request, onDiagnostic: e => events.push(e) });
    assert.ok(input.inputUrl.length < 150);
    const mediaUrl = await childUrl(input.inputUrl), segmentUrl = await childUrl(mediaUrl);
    const response = await fetch(segmentUrl, { headers: { Range: "bytes=5-15" } });
    assert.equal(response.status, 206); assert.equal(response.headers.get("content-range"), "bytes 5-15/256");
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.alloc(11, 42));
    assert.ok(f.requests.every(r => r.complete));
    assert.ok(input.snapshot().maxUpstreamUrlLength > 9000);
    assert.equal(input.snapshot().playlistStartUtc, "2026-10-25T17:00:00.000Z");
    assert.doesNotMatch(JSON.stringify(events), /ticket=|END|https?:/u);
  } finally { await input?.close(); await f.close(); }
});

test("encrypted media and unsafe nested URLs are refused without fetching keys or private addresses", async () => {
  for (const options of [{ encrypted: true }, { privateUri: true }]) {
    const f = await fixture(options); let input;
    try {
      input = await openHlsInput(f.source, { validateUrl: f.validateUrl, request: f.request });
      const mediaUrl = await childUrl(input.inputUrl);
      const media = await fetch(mediaUrl);
      if (options.encrypted) {
        assert.equal(media.status, 502); assert.equal(input.snapshot().lastError.code, "HLS_ENCRYPTED_SOURCE");
      } else {
        const uri = (await media.text()).split("\n").find(line => line && !line.startsWith("#"));
        assert.equal((await fetch(uri)).status, 502); assert.equal(input.snapshot().lastError.code, "HLS_UNSAFE_URL");
      }
      assert.equal(f.requests.length, 2);
    } finally { await input?.close(); await f.close(); }
  }
});

test("HLS redirects are validated before following; HTTP failures retain their stage without response bodies", async () => {
  const f = await fixture({ redirect: true });
  try {
    await assert.rejects(openHlsInput(f.source, { validateUrl: f.validateUrl, request: f.request }), e => e.code === "HLS_UNSAFE_URL");
    assert.equal(f.requests.length, 1);
    await assert.rejects(openHlsInput(f.source, { validateUrl: f.validateUrl, request: async () => new Response("private provider body", { status: 403 }) }), e => {
      assert.equal(e.stage, "MANIFEST_OPEN"); assert.equal(e.status, 403);
      assert.doesNotMatch(e.message, /private provider body|ticket=/u); return true;
    });
  } finally { await f.close(); }
});

test("a VOD window starts at the requested segment, keeps its programme clock and rejects offsets past the end", async () => {
  const f = await fixture({ bodies: [Buffer.alloc(20, 1), Buffer.alloc(20, 2), Buffer.alloc(20, 3)] }); let input;
  try {
    input = await openHlsInput(f.source, { validateUrl: f.validateUrl, request: f.request, vodStartSeconds: 14, windowSeconds: 5 });
    const media = await childUrl(input.inputUrl), segment = await childUrl(media);
    assert.deepEqual(Buffer.from(await (await fetch(segment)).arrayBuffer()), Buffer.alloc(20, 2));
    assert.equal(input.snapshot().windowStartSeconds, 12);
    assert.equal(input.snapshot().windowStartUtc, '2026-10-25T17:00:12.000Z');
    assert.equal(input.snapshot().mediaDurationSeconds, 36);
    assert.equal(f.requests.at(-1).segmentIndex, 1);
    await input.close();
    input = await openHlsInput(f.source, { validateUrl: f.validateUrl, request: f.request, vodStartSeconds: 36, windowSeconds: 5 });
    const invalid = await childUrl(input.inputUrl);
    assert.equal((await fetch(invalid)).status, 502);
    assert.equal(input.snapshot().lastError.code, 'HLS_OFFSET_OUT_OF_RANGE');
  } finally { await input?.close(); await f.close(); }
});

test("real FFmpeg truncates a long request at 4095; the HLS transport captures and decodes the complete media", {
  skip: process.env.CLIPFORGE_RUN_MEDIA_TESTS !== "true",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-long-hls-")); let f;
  try {
    const media = path.join(root, "owned.ts");
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "12", "-c:v", "libx264", "-threads", "1", "-g", "5", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mpegts", media]);
    f = await fixture({ body: await readFile(media) });
    await assert.rejects(runMedia(process.env.FFPROBE_PATH || "ffprobe", ["-v", "error", "-i", f.source]), /400/u);
    assert.equal(f.requests[0].length, 4095); assert.equal(f.requests[0].complete, false);
    let metadata;
    const output = await captureSegmentedStream({ url: f.source, uploadDir: path.join(root, "capture"), captureSeconds: 5,
      hlsInputFactory: (url, options) => openHlsInput(url, { ...options, validateUrl: f.validateUrl, request: f.request }),
      onCaptureMetadata: async value => { metadata = value; } });
    const result = await validateMp4(output, { requireAudio: true });
    assert.ok(Math.abs(result.duration - 5) < 1, "stream-copy capture stays within one GOP; final render duration is checked separately");
    assert.equal(result.fullDecode, true); assert.equal(result.audioCodec, "aac");
    assert.ok(f.requests.slice(1).every(r => r.complete));
    assert.ok(metadata.maxUpstreamUrlLength > 9000);
    const previousRequests = f.requests.length;
    let recoveredMetadata;
    const recovered = await captureSegmentedStream({ url: f.source, uploadDir: path.join(root, "capture"), captureSeconds: 5,
      hlsInputFactory: () => { throw new Error("A completed capture must not download again"); },
      onCaptureMetadata: async value => { recoveredMetadata = value; } });
    assert.equal(f.requests.length, previousRequests);
    assert.equal((await validateMp4(recovered, { requireAudio: true })).fullDecode, true);
    assert.deepEqual(recoveredMetadata.sourceRanges, metadata.sourceRanges);
  } finally { await f?.close(); await rm(root, { recursive: true, force: true }); }
});

test("resumed VOD skips an already captured HLS segment and journals its gap instead of repeating footage", {
  skip: process.env.CLIPFORGE_RUN_MEDIA_TESTS !== "true",
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "clipforge-hls-resume-")); let f;
  try {
    const media = path.join(root, "owned.ts");
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=64x64:rate=5", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=16000", "-t", "12", "-c:v", "libx264", "-threads", "1", "-g", "5", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "mpegts", media]);
    const body = await readFile(media);
    f = await fixture({ bodies: [body, body, body] });
    const common = { url: f.source, uploadDir: path.join(root, "capture"), isVodSource: true,
      hlsInputFactory: (url, options) => openHlsInput(url, { ...options, validateUrl: f.validateUrl, request: f.request }) };
    const first = await captureSegmentedStream({ ...common, captureSeconds: 5 });
    const original = await readFile(path.join(root, "capture", ".stream-parts", "part-000000.ts"));
    assert.ok((await validateMp4(first, { requireAudio: true })).duration >= 5);
    f.requests.length = 0; let metadata;
    const resumed = await captureSegmentedStream({ ...common, captureSeconds: 10, onCaptureMetadata: async info => { metadata = info; } });
    assert.ok(f.requests.filter(r => r.segmentIndex >= 0).every(r => r.segmentIndex >= 1));
    assert.deepEqual(await readFile(path.join(root, "capture", ".stream-parts", "part-000000.ts")), original);
    const info = await probeMediaFile(resumed);
    // Stream-copy source material may finish inside a GOP at 5 fps. Keep its
    // exact measured tracks, decode all retained bytes, and verify a final cut
    // bounded by both tracks; never weaken the final MP4 synchronization gate.
    assert.ok(info.video && info.audio);
    assert.ok(Math.abs(Number(info.video.duration) - Number(info.audio.duration)) < 1);
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-xerror", "-i", resumed, "-f", "null", "-"]);
    const final = path.join(root, "final.mp4");
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-i", resumed, "-t", "9", "-c:v", "libx264", "-threads", "1", "-pix_fmt", "yuv420p", "-c:a", "aac", final]);
    assert.equal((await validateMp4(final, { requireAudio: true, duration: 9 })).fullDecode, true);
    assert.equal(metadata.continuityBreaks.length, 1);
    assert.equal(metadata.sourceRanges.length, 2);
    assert.equal(metadata.sourceRanges[1].sourceStartUtc, "2026-10-25T17:00:12.000Z");
  } finally { await f?.close(); await rm(root, { recursive: true, force: true }); }
});

test("VOD windows retain implicit byte offsets, media-sequence, discontinuities and changing init maps", async () => {
  const text = '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-DISCONTINUITY-SEQUENCE:2\n#EXT-X-MAP:URI="init-a.mp4"\n#EXTINF:10,\n#EXT-X-BYTERANGE:100@0\nall.mp4\n#EXT-X-DISCONTINUITY\n#EXTINF:10,\n#EXT-X-BYTERANGE:100\nall.mp4\n#EXTINF:10,\n#EXT-X-BYTERANGE:100\nall.mp4\n#EXT-X-DISCONTINUITY\n#EXT-X-MAP:URI="init-b.mp4"\n#EXTINF:10,\n#EXT-X-BYTERANGE:100\nall.mp4\n#EXT-X-ENDLIST\n';
  const input = await openHlsInput('https://example.com/media.m3u8', { validateUrl: async url => url,
    request: async () => new Response(text), vodStartSeconds: 20, windowSeconds: 20 });
  try {
    const window = await (await fetch(input.inputUrl)).text();
    assert.match(window, /#EXT-X-MEDIA-SEQUENCE:102/u); assert.match(window, /#EXT-X-DISCONTINUITY-SEQUENCE:3/u);
    assert.match(window, /#EXT-X-BYTERANGE:100@200/u); assert.match(window, /#EXT-X-BYTERANGE:100@300/u);
    assert.equal((window.match(/#EXT-X-MAP:/gu) || []).length, 2);
    assert.equal((window.match(/^#EXT-X-DISCONTINUITY$/gmu) || []).length, 1);
  } finally { await input.close(); }
});
