import test from "node:test";
import assert from "node:assert/strict";
import { planStory, buildSceneMotion, LocalImageProvider } from "../services/owned-content/SceneStoryService.mjs";
import { buildKeepRanges, remapTranscript } from "../services/autoedit/VideoAutoEditService.mjs";
test("local Maya story has six original coherent scenes and a continuity manifest", async () => {
  const plan = await planStory({ topic: "Una ciudad maya en la selva", duration: 60 });
  assert.equal(plan.scenes.length, 6); assert.equal(new Set(plan.scenes.map(s => s.narration)).size, 6);
  assert.ok(plan.manifest.character); assert.ok(plan.scenes.every(s => s.movement && s.visualDescription));
});
test("missing script and images produce WAITING_RESOURCE", async () => {
  await assert.rejects(planStory({ topic: "Tema sin proveedor" }), { code: "WAITING_RESOURCE" });
  await assert.rejects(new LocalImageProvider().resolve({ order: 1 }, {}), { code: "WAITING_RESOURCE" });
});
test("scene motion is duration-bound and does not inject shell commands", () => {
  assert.match(buildSceneMotion("pan-left", 300, 360, 640), /zoompan/);
  assert.throws(() => buildSceneMotion("zoom-in", "1;rm", 360, 640));
});
test("silence cuts preserve padding and recorded speech boundaries", () => {
  const ranges = buildKeepRanges(10, [{ start: 3, end: 7 }], "NORMAL");
  assert.deepEqual(ranges, [{ start: 0, end: 3.35 }, { start: 6.65, end: 10 }]);
  assert.deepEqual(buildKeepRanges(10, [{ start: 3, end: 7 }], "NORMAL", [{ startTime: 5, endTime: 6 }]), [{ start: 0, end: 10 }]);
});
test("subtitle times follow actual retained ranges", () => {
  const result = remapTranscript({ segments: [{ startTime: 7, endTime: 9, text: "Texto real" }] }, [{ start: 0, end: 3 }, { start: 6, end: 10 }]);
  assert.equal(result.segments[0].startTime, 4); assert.equal(result.segments[0].endTime, 6);
});
