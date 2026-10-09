import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { randomUUID } from "node:crypto";

async function loadClient() {
  const source = await readFile(new URL("../lib/story-asset-client.ts", import.meta.url), "utf8");
  const js = stripTypeScriptTypes(source, { mode: "transform" });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}#${randomUUID()}`);
}
test("ten image uploads preserve original order and recover a temporary fetch failure", async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const calls = [];
  let lostConnection = true;
  globalThis.fetch = async (_url, init) => {
    calls.push(init.body.name);
    if (init.body.name === "scene-5.jpg" && lostConnection) { lostConnection = false; throw new TypeError("Failed to fetch"); }
    return Response.json({ relativePath: `story-assets/${randomUUID()}.jpg` });
  };
  const { uploadStoryAssets } = await loadClient();
  const files = Array.from({ length: 10 }, (_, i) => new File(["test"], `scene-${i+1}.jpg`, { type: "image/jpeg" }));
  const updates = [];
  const cache = new Map();
  const paths = await uploadStoryAssets(files, cache, { onProgress: (saved, total) => updates.push([saved, total]) });
  assert.equal(paths.length, 10);
  assert.equal(new Set(paths).size, 10);
  assert.equal(cache.size, 10);
  assert.deepEqual(updates.at(-1), [10, 10]);
  assert.equal(calls.filter(name => name === "scene-5.jpg").length, 2);
  await uploadStoryAssets(files, cache);
  assert.equal(calls.length, 11, "already saved resources must not be re-uploaded");
});
test("failed batches can resume without reuploading confirmed images", async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  let fail = true;
  const confirmed = new Map();
  globalThis.fetch = async (_url, init) => {
    if (init.body.name === "scene-5.jpg" && fail) return Response.json({ error: "No disponible" }, { status: 422 });
    const result = `story-assets/${randomUUID()}.jpg`;
    confirmed.set(init.body.name, result);
    return Response.json({ relativePath: result });
  };
  const { uploadStoryAssets } = await loadClient();
  const files = Array.from({ length: 6 }, (_, i) => new File(["test"], `scene-${i+1}.jpg`, { type: "image/jpeg" }));
  const cache = new Map();
  await assert.rejects(uploadStoryAssets(files, cache), /No disponible/);
  assert.ok(cache.size >= 2);
  const previouslySaved = new Map(confirmed);
  fail = false;
  const result = await uploadStoryAssets(files, cache);
  assert.equal(result.length, 6);
  for (const [name, path] of previouslySaved) {
    const file = files.find(file => file.name === name);
    if (cache.get(file) === path) assert.equal(result[files.indexOf(file)], path);
  }
});
