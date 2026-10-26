import http from "node:http";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { EnvHttpProxyAgent, fetch } from "undici";
import { parsePublicSourceUrl } from "../../lib/public-source-url.mjs";

const dispatcher = new EnvHttpProxyAgent();
const PLAYLIST_LIMIT = 8 * 1024 * 1024;
const RESOURCE_LIMIT = 64 * 1024 * 1024;

export class HlsInputError extends Error {
  constructor(stage, status, code = "HLS_INPUT_FAILED") {
    super(`La entrada HLS falló en ${stage}${status ? ` (HTTP ${status})` : ""}. No se registran URLs firmadas ni respuestas privadas.`);
    this.code = code; this.stage = stage; this.status = status || null;
  }
}

async function validatePublicMediaUrl(raw) {
  const url = await parsePublicSourceUrl(raw);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new HlsInputError("URL_VALIDATION", null, "HLS_UNSAFE_URL");
  return url.toString();
}

/**
 * FFmpeg's HTTP client truncates request targets at 4095 bytes. Keep its input
 * URLs short and forward the complete publisher URL with the normal Node
 * transport, inherited proxy and verified CA trust. No signatures are changed.
 * This is a loopback-only transport, not an arbitrary-URL HTTP proxy.
 */
export async function openHlsInput(sourceUrl, options = {}) {
  const validateUrl = options.validateUrl || validatePublicMediaUrl;
  const request = options.request || ((url, init) => fetch(url, { ...init, dispatcher }));
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const byId = new Map(), byReference = new Map();
  const prefix = randomUUID(); let rootUrl, referenceBytes = 0, origin;
  const stats = { playlistRequests: 0, resourceRequests: 0, bytes: 0, maxUpstreamUrlLength: 0,
    playlistStartUtc: null, firstServedProgramUtc: null, isVod: false, lastError: null,
    windowStartUtc: null, windowStartSeconds: null, mediaDurationSeconds: null };
  const vodStartSeconds = Number(options.vodStartSeconds || 0);
  const windowSeconds = Number(options.windowSeconds || 0);
  if (!Number.isFinite(vodStartSeconds) || vodStartSeconds < 0 || !Number.isFinite(windowSeconds) || windowSeconds < 0) throw new HlsInputError("SOURCE_WINDOW", null, "HLS_INVALID_WINDOW");
  const emit = event => { try { Promise.resolve(options.onDiagnostic?.(event)).catch(() => {}); } catch { /* Reporting never interrupts capture. */ } };
  const failure = (stage, status, code) => {
    const error = new HlsInputError(stage, status, code);
    stats.lastError = { stage: error.stage, status: error.status, code: error.code };
    emit({ type: "HLS_ERROR", ...stats.lastError }); return error;
  };
  async function upstream(raw, { stage, range, method = "GET" } = {}) {
    let url = raw;
    for (let redirects = 0; redirects <= 5; redirects++) {
      signal.throwIfAborted();
      try { url = String(await validateUrl(url)); } catch { throw failure("URL_VALIDATION", null, "HLS_UNSAFE_URL"); }
      stats.maxUpstreamUrlLength = Math.max(stats.maxUpstreamUrlLength, url.length);
      let response;
      try {
        response = await request(url, { method, headers: { "accept-encoding": "identity", ...(range ? { Range: range } : {}) },
          redirect: "manual", signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]) });
      } catch { signal.throwIfAborted(); throw failure(stage, null, "HLS_TRANSPORT_ERROR"); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location"); await response.body?.cancel();
        if (!location || redirects === 5) throw failure(stage, response.status, "HLS_REDIRECT_FAILED");
        url = new URL(location, url).toString(); continue;
      }
      emit({ type: "HLS_HTTP", stage, status: response.status, urlLength: url.length });
      if (!response.ok) { await response.body?.cancel(); throw failure(stage, response.status); }
      return { response, url };
    }
  }
  async function readPlaylist(response) {
    const reader = response.body?.getReader();
    if (!reader) throw failure("MANIFEST_READ", null, "HLS_INVALID_MANIFEST");
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > PLAYLIST_LIMIT) throw failure("MANIFEST_READ", null, "HLS_PLAYLIST_LIMIT");
        chunks.push(Buffer.from(value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error instanceof HlsInputError ? error : failure("MANIFEST_READ"); }
    const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/u, "");
    if (!text.startsWith("#EXTM3U")) throw failure("MANIFEST_READ", null, "HLS_INVALID_MANIFEST");
    if (/^#EXT-X-(?:SESSION-)?KEY:.*\bMETHOD=(?!NONE(?:,|$))/imu.test(text)) throw failure("MANIFEST_READ", null, "HLS_ENCRYPTED_SOURCE");
    return text;
  }
  function register(raw, { playlist = false, role = "video", programUtc = null } = {}) {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) throw failure("URL_VALIDATION", null, "HLS_UNSAFE_URL");
    const url = parsed.toString(), key = `${playlist ? "p" : "r"}:${role}:${programUtc || ""}:${url}`;
    if (byReference.has(key)) return `${origin}/${prefix}/${byReference.get(key)}`;
    referenceBytes += Buffer.byteLength(url);
    if (byId.size >= 20000 || referenceBytes > 32 * 1024 * 1024) throw failure("MANIFEST_READ", null, "HLS_REFERENCE_LIMIT");
    const extension = playlist ? ".m3u8" : /\.(?:ts|m4s|mp4|m4a|aac|mp3|vtt|webvtt)$/iu.exec(parsed.pathname)?.[0].toLowerCase() || ".ts";
    const id = String(byId.size), name = `${id}${extension}`;
    byId.set(name, { url, playlist, role, programUtc }); byReference.set(key, name);
    return `${origin}/${prefix}/${name}`;
  }
  function windowVod(text, role) {
    const isVod = text.includes("#EXT-X-ENDLIST"), resumeTime = Date.parse(options.resumeSourceUtc);
    if ((!isVod && !Number.isFinite(resumeTime)) || !/^#EXTINF:/mu.test(text) || !windowSeconds) return text;
    const header = [], segments = []; let tags = [], start = 0, duration = null, sequence = 0, time = null, initTag = null;
    let discontinuitySequence = 0, discontinuities = 0, previousByteEnd = null, previousByteUri = null;
    const segmentTag = /^#EXT(?:INF|-X-(?:PROGRAM-DATE-TIME|BYTERANGE|DISCONTINUITY|GAP|DATERANGE))(?::|$)/u;
    for (const line of text.split(/\r?\n/u)) {
      if (!line.trim() || line === "#EXT-X-ENDLIST") continue;
      if (line.startsWith("#EXT-X-MEDIA-SEQUENCE:")) { sequence = Number(line.slice(22)) || 0; continue; }
      if (line.startsWith("#EXT-X-DISCONTINUITY-SEQUENCE:")) { discontinuitySequence = Number(line.slice(30)) || 0; continue; }
      if (line === "#EXT-X-DISCONTINUITY") discontinuities++;
      if (line.startsWith("#EXT-X-MAP:")) { initTag = line; continue; }
      if (line.startsWith("#EXTINF:")) duration = Number(line.slice(8).split(",")[0]);
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) { const value = Date.parse(line.slice(25)); time = Number.isFinite(value) ? value : null; }
      if (line.startsWith("#")) { (segmentTag.test(line) ? tags : header).push(line); continue; }
      if (!Number.isFinite(duration) || duration <= 0) throw failure("SOURCE_WINDOW", null, "HLS_INVALID_MANIFEST");
      const byteRange = tags.find(t => t.startsWith("#EXT-X-BYTERANGE:"));
      if (byteRange) {
        const match = /^#EXT-X-BYTERANGE:(\d+)(?:@(\d+))?$/u.exec(byteRange);
        if (!match || (!match[2] && (previousByteEnd === null || previousByteUri !== line))) throw failure("SOURCE_WINDOW", null, "HLS_INVALID_MANIFEST");
        const offset = match[2] === undefined ? previousByteEnd : Number(match[2]);
        tags = tags.map(t => t === byteRange ? `#EXT-X-BYTERANGE:${match[1]}@${offset}` : t);
        previousByteEnd = offset + Number(match[1]); previousByteUri = line;
      } else { previousByteEnd = null; previousByteUri = null; }
      segments.push({ index: segments.length, start, end: start + duration, time, tags, uri: line, initTag,
        discontinuitiesBefore: discontinuities - tags.filter(t => t === "#EXT-X-DISCONTINUITY").length });
      start += duration; if (time !== null) time += duration * 1000; duration = null; tags = [];
    }
    if (role !== "audio") stats.mediaDurationSeconds = start;
    if (!isVod && segments.some(s => s.time === null)) throw failure("SOURCE_WINDOW", null, "HLS_CLOCK_REQUIRED");
    if (isVod && vodStartSeconds >= start) throw failure("SOURCE_WINDOW", null, "HLS_OFFSET_OUT_OF_RANGE");
    const chosen = segments.filter(s => Number.isFinite(resumeTime) ? s.time !== null && s.time + 1 >= resumeTime : (options.resumeAtNextSegment ? s.start + 0.001 >= vodStartSeconds : s.end > vodStartSeconds) && s.start < vodStartSeconds + windowSeconds + 30);
    if (!chosen.length) throw failure("SOURCE_WINDOW", null, isVod ? "HLS_OFFSET_OUT_OF_RANGE" : "HLS_WAITING_NEW_SEGMENTS");
    const first = chosen[0];
    if (role !== "audio" && stats.windowStartSeconds === null) {
      stats.windowStartSeconds = first.start; stats.windowStartUtc = first.time === null ? null : new Date(first.time).toISOString();
    }
    // Keep original segment URLs, media sequence, init-map and discontinuities.
    // Selecting the authorized VOD interval here avoids unreliable large -ss
    // seeks returning the opening of the recording repeatedly.
    let previousInit = null;
    return [...header, `#EXT-X-MEDIA-SEQUENCE:${sequence + first.index}`, `#EXT-X-DISCONTINUITY-SEQUENCE:${discontinuitySequence + first.discontinuitiesBefore}`,
      ...chosen.flatMap(s => {
        const map = s.initTag && s.initTag !== previousInit ? [s.initTag] : []; previousInit = s.initTag;
        return [...map, ...s.tags, ...(s.time !== null && !s.tags.some(t => t.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) ? [`#EXT-X-PROGRAM-DATE-TIME:${new Date(s.time).toISOString()}`] : []), s.uri];
      }), ...(isVod ? ["#EXT-X-ENDLIST"] : []), ""].join("\n");
  }
  function rewrite(text, baseUrl, role = "video") {
    text = windowVod(text, role);
    let variant = false, currentTime = null, duration = 0;
    if (text.includes("#EXT-X-ENDLIST")) stats.isVod = true;
    return text.split(/\r?\n/u).map(line => {
      if (line.startsWith("#EXT-X-PROGRAM-DATE-TIME:")) {
        const time = Date.parse(line.slice(25)); currentTime = Number.isFinite(time) ? time : null;
        if (currentTime !== null && role !== "audio" && !stats.playlistStartUtc) stats.playlistStartUtc = new Date(currentTime).toISOString();
      }
      if (line.startsWith("#EXTINF:")) duration = Number(line.slice(8).split(",")[0]) || 0;
      if (line.startsWith("#EXT-X-STREAM-INF:")) variant = true;
      if (line.startsWith("#")) return line.replace(/URI="([^"]+)"/gu, (_match, uri) => {
        const playlist = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF|RENDITION-REPORT):/u.test(line);
        const entryRole = /^#EXT-X-MEDIA:.*TYPE=AUDIO(?:,|$)/u.test(line) ? "audio" : role;
        return `URI="${register(new URL(uri, baseUrl).toString(), { playlist, role: entryRole })}"`;
      });
      if (!line.trim()) return line;
      const result = register(new URL(line.trim(), baseUrl).toString(), { playlist: variant, role,
        programUtc: !variant && currentTime !== null ? new Date(currentTime).toISOString() : null });
      if (!variant && currentTime !== null) currentTime += duration * 1000;
      variant = false; duration = 0; return result;
    }).join("\n");
  }
  let initial;
  try { initial = await upstream(sourceUrl, { stage: "MANIFEST_OPEN" }); rootUrl = initial.url; initial = await readPlaylist(initial.response); }
  catch (error) { controller.abort(); throw error; }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Connection", "close");
    const match = new RegExp(`^/${prefix}/(\\d+\\.(?:m3u8|ts|m4s|mp4|m4a|aac|mp3|vtt|webvtt))$`, "u").exec(req.url || "");
    const entry = match && byId.get(match[1]);
    if (!entry || !["GET", "HEAD"].includes(req.method)) { res.writeHead(404); res.end(); return; }
    const range = req.headers.range;
    if (range && !/^bytes=\d+-\d*$/u.test(range)) { res.writeHead(416); res.end(); return; }
    try {
      if (entry.playlist) {
        stats.playlistRequests++;
        let text, baseUrl;
        if (entry.url === rootUrl && initial !== null) { text = initial; initial = null; baseUrl = rootUrl; }
        else { const result = await upstream(entry.url, { stage: "MANIFEST_OPEN" }); text = await readPlaylist(result.response); baseUrl = result.url; }
        const bytes = Buffer.from(rewrite(text, baseUrl, entry.role));
        res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl", "Content-Length": bytes.length });
        res.end(req.method === "HEAD" ? undefined : bytes); return;
      }
      stats.resourceRequests++;
      const { response } = await upstream(entry.url, { stage: "SEGMENT_OPEN", range, method: req.method });
      const length = Number(response.headers.get("content-length"));
      if (length > RESOURCE_LIMIT) { await response.body?.cancel(); throw failure("SEGMENT_READ", null, "HLS_RESOURCE_LIMIT"); }
      if (entry.programUtc && entry.role !== "audio" && !stats.firstServedProgramUtc) stats.firstServedProgramUtc = entry.programUtc;
      const headers = {};
      for (const name of ["content-type", "content-range", "accept-ranges"]) { const value = response.headers.get(name); if (value) headers[name] = value; }
      if (!response.headers.get("content-encoding") && response.headers.get("content-length")) headers["content-length"] = response.headers.get("content-length");
      res.writeHead(response.status, headers);
      if (req.method === "HEAD" || !response.body) { await response.body?.cancel(); res.end(); return; }
      let bytes = 0;
      const counter = new Transform({ transform(chunk, _encoding, callback) {
        bytes += chunk.length; stats.bytes += chunk.length;
        if (bytes > RESOURCE_LIMIT) callback(failure("SEGMENT_READ", null, "HLS_RESOURCE_LIMIT")); else callback(null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), counter, res, { signal });
    } catch (error) {
      if (!signal.aborted && !(error instanceof HlsInputError) && !res.destroyed) stats.lastError = { stage: "SEGMENT_READ", status: null, code: "HLS_TRANSPORT_ERROR" };
      if (!res.headersSent) { res.writeHead(error.status || 502); res.end("ClipForge media input unavailable."); } else res.destroy();
    }
  });
  server.requestTimeout = 45000;
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  origin = `http://127.0.0.1:${server.address().port}`;
  const inputUrl = register(rootUrl, { playlist: true });
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true; controller.abort(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve)); byId.clear(); byReference.clear();
  };
  const abort = () => { void close(); };
  options.signal?.addEventListener("abort", abort, { once: true });
  return { inputUrl, snapshot: () => ({ ...stats }), close: async () => { options.signal?.removeEventListener("abort", abort); await close(); } };
}
