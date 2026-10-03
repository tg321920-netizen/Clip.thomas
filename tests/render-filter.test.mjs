import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRenderVideoPlan,
  buildVideoFilter,
} from "../services/clip/RenderService.mjs";

test("conversation framing uses filter_complex with a single labeled output", () => {
  const plan = buildRenderVideoPlan("CONVERSATION", [
    "zoompan=z='1.05':d=1:s=1080x1920:fps=25",
    "ass='/tmp/subtitles.ass'",
  ]);

  assert.equal(plan.mode, "complex");
  assert.equal(plan.args[0], "-filter_complex");
  assert.equal(plan.args.includes("-vf"), false);
  assert.match(plan.filter, /^\[0:v\]split=2\[bg\]\[fg\];/);
  assert.match(plan.filter, /\[bgv\]\[fgv\]overlay=.*\[basev\]/);
  assert.match(plan.filter, /\[basev\]zoompan=/);
  assert.match(plan.filter, /ass='\/tmp\/subtitles\.ass'\[vout\]$/);

  const maps = plan.args
    .map((value, index) => value === "-map" ? plan.args[index + 1] : null)
    .filter(Boolean);
  assert.deepEqual(maps, ["[vout]", "0:a?"]);
});

test("simple framing keeps the standard -vf pipeline", () => {
  const plan = buildRenderVideoPlan("FILL", ["setsar=1"]);

  assert.equal(plan.mode, "simple");
  assert.equal(plan.args.includes("-vf"), true);
  assert.equal(plan.args.includes("-filter_complex"), false);
  assert.match(plan.filter, /crop=1080:1920/);
});

test("conversation mode cannot be sent to the simple filter builder", () => {
  assert.throws(
    () => buildVideoFilter("CONVERSATION"),
    /filter_complex/,
  );
});
