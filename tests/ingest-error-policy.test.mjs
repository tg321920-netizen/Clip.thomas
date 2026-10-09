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
