import test from "node:test";
import assert from "node:assert/strict";
import { selectIndependentClips } from "../services/analysis/BestClipsService.mjs";

const clip = (id, startTime, endTime) => ({
  id, startTime, endTime, duration: endTime - startTime,
  text: `Idea completa independiente ${id}.`,
});

test("five requested clips return three independent candidates without padding", () => {
  const candidates = [
    clip("a", 0, 30),
    clip("a-copy", 0, 30),
    clip("a-overlap", 20, 50),
    clip("b", 40, 70),
    clip("unfinished-window", 78, 90),
    clip("c", 90, 121),
  ];
  const selected = selectIndependentClips(candidates, { count: 5, minDuration: 25, maxDuration: 35 });
  assert.deepEqual(selected.map(x => x.id), ["a", "b", "c"]);
  assert.equal(selected.length, 3);
});

test("selection allows exactly requested count and excludes overlapping windows", () => {
  const candidates = [clip("first", 0, 30), clip("second", 30, 60), clip("third", 60, 90)];
  const selected = selectIndependentClips(candidates, { count: 2, minDuration: 25, maxDuration: 35 });
  assert.deepEqual(selected.map(x => x.id), ["first", "second"]);
});

test("selection rejects invalid and out-of-range moments and can return zero", () => {
  const candidates = [
    { id: "nan", startTime: NaN, endTime: 30, duration: 30 },
    clip("too-short", 0, 15),
    clip("too-long", 20, 80),
    { id: "reverse", startTime: 100, endTime: 98, duration: 30 },
  ];
  assert.deepEqual(selectIndependentClips(candidates, { count: 5, minDuration: 25, maxDuration: 35 }), []);
});

test("five is not a fixed limit: eight distinct moments can be selected without copying a reaction", () => {
  const candidates = Array.from({ length: 8 }, (_, i) => clip(`moment-${i}`, i * 40, i * 40 + 30));
  candidates.splice(1, 0, clip('duplicate-first-reaction', 0, 30));
  const selected = selectIndependentClips(candidates, { count: 8, minDuration: 25, maxDuration: 35 });
  assert.equal(selected.length, 8);
  assert.equal(new Set(selected.map(c => c.startTime)).size, 8);
  assert.ok(!selected.some(c => c.id === 'duplicate-first-reaction'));
});
