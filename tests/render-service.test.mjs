import test from "node:test";
import assert from "node:assert/strict";
import { buildVideoFilter } from "../services/clip/RenderService.mjs";

test("FILL framing scales and crops to vertical output", () => {
  const filter = buildVideoFilter("FILL");
  assert.match(filter, /scale=1080:1920/);
  assert.match(filter, /crop=1080:1920/);
  assert.match(filter, /setsar=1/);
});

test("FIT framing preserves the full frame with padding", () => {
  const filter = buildVideoFilter("FIT");
  assert.match(filter, /force_original_aspect_ratio=decrease/);
  assert.match(filter, /pad=1080:1920/);
});

test("unknown framing modes are rejected", () => {
  assert.throws(() => buildVideoFilter("UNKNOWN"), /Unsupported framing mode/);
});
