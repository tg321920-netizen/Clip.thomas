import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { getStoryProviderStatus, storyProviderConfig, CompatibleStoryImageProvider, StoryGenerationBudget } from "../services/owned-content/StoryGenerationProviders.mjs";
import { planStory, SceneStoryService } from "../services/owned-content/SceneStoryService.mjs";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cf-provider-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const config = storyProviderConfig({ CLIPFORGE_STORY_EXTERNAL_AUTHORIZED: "true", CLIPFORGE_STORY_IMAGE_PROVIDER: "openai-compatible", CLIPFORGE_STORY_IMAGE_MODEL: "gpt-image-1-mini", CLIPFORGE_STORY_IMAGE_API_KEY: "test-key", CLIPFORGE_STORY_IMAGE_UNIT_COST_USD: "0.02", CLIPFORGE_STORY_SCRIPT_MAX_COST_USD: "0.05", CLIPFORGE_STORY_MAX_COST_USD: "0.2" });
  return { root, config, projectId: randomUUID() };
}
test("provider readiness is truthful and never exposes credentials", () => {
  assert.equal(getStoryProviderStatus({}).automaticReady, false);
  assert.equal(getStoryProviderStatus({ CLIPFORGE_STORY_EXTERNAL_AUTHORIZED: "true", CLIPFORGE_STORY_IMAGE_API_KEY: "secret" }).imageReady, false);
  assert.doesNotMatch(JSON.stringify(getStoryProviderStatus({ CLIPFORGE_STORY_IMAGE_API_KEY: "secret" })), /secret/);
});
test("browser authorizedPaid cannot authorize a paid script provider", async () => {
  let calls = 0;
  await assert.rejects(planStory({ topic: "Ciudad abandonada", authorizedPaid: true }, { scriptProvider: { requiresPayment: true, authorized: false, generate: async () => { calls++; } } }), { code: "WAITING_RESOURCE" });
  assert.equal(calls, 0);
});
test("own narration avoids paid script calls and supports twelve scenes", async () => {
  const narration = Array.from({ length: 12 }, (_, i) => `La escena ${i + 1} revela una pista original mientras la protagonista sigue buscando respuestas y avanza con cuidado.`).join(" ");
  const plan = await planStory({ narration, sceneCount: 12, duration: 90 }, { scriptProvider: { requiresPayment: true, generate: () => { throw new Error("must not call"); } } });
  assert.equal(plan.scenes.length, 12); assert.equal(plan.provider, "user-script");
  assert.equal(new Set(plan.scenes.map(scene => scene.visualDescription)).size, 12);
});
test("generated scripts preserve the provider's scene visuals and shared characters", async () => {
  const scenes = Array.from({ length: 6 }, (_, i) => ({ narration: `Narración original ${i + 1}.`, visualDescription: `Plano concreto ${i + 1}` }));
  const plan = await planStory({ topic: "Historia nueva" }, { scriptProvider: { name: "test-provider", generate: async () => ({ title: "El secreto", character: "Investigadora de abrigo azul", palette: "azul y cobre", scenes }) } });
  assert.equal(plan.scenes[3].visualDescription, "Plano concreto 4"); assert.match(plan.manifest.character, /abrigo azul/); assert.equal(plan.title, "El secreto");
});
test("image generation is cached, includes continuity and makes no automatic paid retry", async t => {
  const { root, config, projectId } = await fixture(t); let calls = 0, sent;
  // Byte fixture exercises the adapter transport only. It is not an AI image or visual acceptance.
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
  const provider = new CompatibleStoryImageProvider(config, { root, fetchImpl: async (_url, init) => {
    calls++; sent = JSON.parse(init.body); return new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] }), { status: 200 });
  } });
  const scene = { order: 1, visualDescription: "Una plaza vacía iluminada" }, input = { generationMode: "AI", projectId }, manifest = { character: "abrigo azul", palette: "cobre", style: "cinematográfico" };
  const first = await provider.resolve(scene, input, manifest); const second = await provider.resolve(scene, input, manifest);
  assert.equal(calls, 1); assert.equal(second.reused, true); assert.equal(first.relativePath, second.relativePath);
  assert.deepEqual(await readFile(first.filename), bytes); assert.match(sent.prompt, /abrigo azul/); assert.equal(sent.response_format, undefined);
  assert.equal(JSON.parse(await readFile(path.join(root, "stories", projectId, "external-budget.json"))).reservedUsd, 0.02);
});
test("disabled authorization stops image calls despite client flags", async t => {
  const { root, config, projectId } = await fixture(t); config.authorized = false; let calls = 0;
  const provider = new CompatibleStoryImageProvider(config, { root, fetchImpl: () => { calls++; throw new Error("must not call"); } });
  await assert.rejects(provider.resolve({ order: 1, visualDescription: "Plan" }, { generationMode: "AI", authorizedPaid: true, projectId }, {}), { code: "WAITING_RESOURCE" });
  assert.equal(calls, 0);
});
test("failed external requests remain reserved and cannot exceed the job estimate", async t => {
  const { root, config, projectId } = await fixture(t); config.maxCostUsd = 0.02; let calls = 0;
  const provider = new CompatibleStoryImageProvider(config, { root, fetchImpl: async () => { calls++; return new Response("{}", { status: 503 }); } });
  const run = () => provider.resolve({ order: 1, visualDescription: "Plan" }, { generationMode: "AI", projectId }, {});
  await assert.rejects(run(), /HTTP 503/); await assert.rejects(run(), { code: "WAITING_RESOURCE" }); assert.equal(calls, 1);
});
test("budget reservations cannot race past the limit", async t => {
  const { root, config, projectId } = await fixture(t); config.maxCostUsd = 0.02;
  const budget = new StoryGenerationBudget(config, { root });
  const results = await Promise.allSettled([budget.reserve(projectId, "image"), budget.reserve(projectId, "image")]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(JSON.parse(await readFile(path.join(root, "stories", projectId, "external-budget.json"))).reservedUsd, 0.02);
});
test("unsupported URL-only image responses never trigger a second download", async t => {
  const { root, config, projectId } = await fixture(t); let calls = 0;
  const provider = new CompatibleStoryImageProvider(config, { root, fetchImpl: async () => { calls++; return new Response(JSON.stringify({ data: [{ url: "http://127.0.0.1/private" }] })); } });
  await assert.rejects(provider.resolve({ order: 1 }, { generationMode: "AI", projectId }, {}), /base64/); assert.equal(calls, 1);
});
test("missing image configuration cannot consume a script provider", async t => {
  const { root, projectId } = await fixture(t); const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(() => { if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous; });
  let calls = 0;
  const service = new SceneStoryService({ config: storyProviderConfig({}), scriptProvider: { name: "test", generate: async () => { calls++; } } });
  await assert.rejects(service.render(projectId, { topic: "Nueva historia", generationMode: "AI" }), { code: "WAITING_RESOURCE" }); assert.equal(calls, 0);
});
test("saved scene plans survive a retry without repeating script calls or rendering", async t => {
  const { root, projectId } = await fixture(t); const previous = process.env.CLIPFORGE_STORAGE_DIR;
  process.env.CLIPFORGE_STORAGE_DIR = root;
  t.after(() => { if (previous === undefined) delete process.env.CLIPFORGE_STORAGE_DIR; else process.env.CLIPFORGE_STORAGE_DIR = previous; });
  let calls = 0;
  const scriptProvider = { name: "test", generate: async () => { calls++; return { scenes: Array.from({ length: 6 }, (_, i) => ({ narration: `Frase ${i + 1}.`, visualDescription: `Plano ${i + 1}` })) }; } };
  const imageProvider = { name: "test", resolve: async () => { const error = new Error("No image test fixture"); error.code = "WAITING_RESOURCE"; throw error; } };
  const service = new SceneStoryService({ scriptProvider, imageProvider }); const input = { topic: "Nueva historia", generationMode: "AI" };
  await assert.rejects(service.render(projectId, input), { code: "WAITING_RESOURCE" });
  await assert.rejects(service.render(projectId, input), { code: "WAITING_RESOURCE" }); assert.equal(calls, 1);
});
