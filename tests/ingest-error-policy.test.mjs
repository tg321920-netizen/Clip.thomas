import test from "node:test";
import assert from "node:assert/strict";
import { isRetryableIngestError } from "../lib/ingest-error-policy.mjs";

test("remote HTTP 404 is permanent, not queued for repeated retries", () => {
  assert.equal(isRetryableIngestError(new Error("ERROR: [kick:vod] Unable to download JSON metadata: HTTP Error 404: Not Found")), false);
  assert.equal(isRetryableIngestError(new Error("Video unavailable")), false);
  assert.equal(isRetryableIngestError(new Error("YouTube: Sign in to confirm you're not a bot")), false);
});
test("timeouts, server errors and temporary disconnections keep bounded retries", () => {
  assert.equal(isRetryableIngestError(new Error("HTTP Error 503: Service Unavailable")), true);
  assert.equal(isRetryableIngestError(new Error("ETIMEDOUT")), true);
  assert.equal(isRetryableIngestError(new Error("ECONNRESET")), true);
});

import { isDirectMediaUrl, formatRemoteImportFailure } from "../services/ingest/UrlIngestService.mjs";

test("direct MP4 and HLS links with signed query parameters choose the direct path", () => {
  assert.equal(isDirectMediaUrl("https://media.example/video.mp4?signature=abc"), true);
  assert.equal(isDirectMediaUrl("https://media.example/live/playlist.m3u8?expires=123"), true);
  assert.equal(isDirectMediaUrl("https://media.example/folder/video.webm"), true);
  assert.equal(isDirectMediaUrl("https://kick.com/westcol/videos/01a11cba-0720-7045-b89a-c2c8fe18849f"), false);
  assert.equal(isDirectMediaUrl("https://media.example/watch?file=video.mp4"), false);
  assert.equal(isDirectMediaUrl("file:///etc/passwd.mp4"), false);
});

test("Kick provider 404 explains platform incompatibility without pretending a completed download", () => {
  const message = formatRemoteImportFailure(
    "https://kick.com/westcol/videos/01a11cba-0720-7045-b89a-c2c8fe18849f",
    new Error("ERROR: [kick:vod] Unable to download JSON metadata: HTTP Error 404: Not Found")
  );
  assert.match(message, /Kick rechazó/);
  assert.match(message, /Subir video/);
  assert.equal(isRetryableIngestError(new Error(message)), false);
});

test("an offline Kick livestream is a permanent failure for this attempt, not RETRY_WAIT", () => {
  const offline = new Error("No se pudo importar esa URL. ERROR: [kick:live] westcol: The channel is not currently live");
  assert.equal(isRetryableIngestError(offline), false);
  assert.equal(isRetryableIngestError(new Error("The channel is offline")), false);
  assert.equal(isRetryableIngestError(new Error("HTTP Error 502: Bad Gateway")), true);
});

test("Kick offline errors explain that a channel link is not a recorded video", () => {
  const message = formatRemoteImportFailure(
    "https://kick.com/westcol",
    new Error("ERROR: [kick:live] westcol: The channel is not currently live"),
  );
  assert.match(message, /no está transmitiendo en vivo/);
  assert.match(message, /grabaciones de Kick sigue limitada/);
  assert.equal(isRetryableIngestError(new Error(message)), false);
});
