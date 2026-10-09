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
