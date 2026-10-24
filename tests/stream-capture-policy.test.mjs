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

test("VOD recovery seeks past measured completed duration instead of downloading it again", () => {
  const args = buildStreamCaptureArgs({ resolvedUrl: '/fixture.mp4', remaining: 55, chunkSeconds: 30, startNumber: 1, outputPattern: '/tmp/part-%06d.ts', seekSeconds: 5.12 });
  assert.equal(args[args.indexOf('-ss') + 1], '5.12');
  assert.ok(args.indexOf('-ss') < args.indexOf('-i'));
});
