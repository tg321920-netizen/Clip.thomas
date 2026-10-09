import test from "node:test";
import assert from "node:assert/strict";
import { buildStreamCaptureArgs } from "../services/ingest/UrlIngestService.mjs";

test("live capture stream-copies into recoverable MPEG-TS segments", () => {
  const args = buildStreamCaptureArgs({
    resolvedUrl: "https://cdn.example/live.m3u8",
    remaining: 180,
    chunkSeconds: 60,
    startNumber: 0,
    outputPattern: "/tmp/part-%06d.ts",
  });

  assert.deepEqual(args.slice(args.indexOf("-c"), args.indexOf("-f") + 2), ["-c", "copy", "-f", "segment"]);
  assert.ok(args.includes("mpegts"));
  assert.equal(args.at(-1), "/tmp/part-%06d.ts");
  assert.equal(args.includes("mpeg4"), false);
});
