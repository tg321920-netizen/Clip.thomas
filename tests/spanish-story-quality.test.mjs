import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { planStory } from "../services/owned-content/SceneStoryService.mjs";
import { selectLicensedSceneImages } from "../services/owned-content/LicensedStoryImageProvider.mjs";
import { alignStoryNarration } from "../services/owned-content/StoryNarrationTiming.mjs";
import { getNarrationVoiceStatus } from "../services/owned-content/LocalNeuralNarrationProvider.mjs";

test("short original scripts keep the author's complete ending and can use three scenes", async () => {
  const narration = "Una semilla parece pequeña, pero puede convertirse en un árbol que ofrece sombra. Sus raíces necesitan tiempo y cuidado antes de mostrar una hoja. Cada día de paciencia también forma parte del camino.";
  const plan = await planStory({ narration, sceneCount: 3, duration: 40 });
  assert.equal(plan.scenes.length, 3); assert.equal(plan.scenes.map(scene => scene.narration).join(" "), narration);
  await assert.rejects(planStory({ narration: narration.slice(0, -1), sceneCount: 3, duration: 40 }), /frase completa/);
});

test("the free photo library selects distinct relevant assets and refuses unrelated filler", async () => {
  const library = JSON.parse(await readFile(new URL("../public/story-library/manifest.json", import.meta.url), "utf8"));
  const scenes = ["Una semilla guarda una posibilidad.", "Las raíces sostienen el trabajo bajo tierra.", "La primera hoja empieza a crecer.", "El árbol sigue su propio ritmo.", "Cada paso encuentra un camino.", "Mañana llega un nuevo amanecer."].map((narration, index) => ({ narration, order: index + 1 }));
  const selected = selectLicensedSceneImages(scenes, library.assets);
  assert.equal(new Set(selected.map(item => item.asset.id)).size, 6);
  assert.ok(selected.every(item => item.score > 0 && item.asset.license === "CC0-1.0" && item.reviewRequired));
  assert.throws(() => selectLicensedSceneImages([{ order: 1, narration: "El carburador necesita un tornillo y una válvula." }], library.assets), /imágenes propias/);
});

test("ASR alignment preserves corrected script words, reports interpolation and rejects different speech", () => {
  const reference = "La calma también cuenta cuando buscas un nuevo camino.";
  const text = "La calma cuenta cuando buscas un nuevo camino.";
  const words = text.split(" ").map((text, index) => ({ text, startTime: index * 0.6, endTime: index * 0.6 + 0.5 }));
  const aligned = alignStoryNarration(reference, { segments: [{ text, startTime: 0, endTime: 5, words }] }, 5);
  assert.equal(aligned.cues.map(cue => cue.text).join(" "), reference);
  assert.equal(aligned.approximatedWords, 1);
  assert.ok(aligned.words.every(word => word.endTime <= 5 && word.endTime > word.startTime));
  assert.equal(aligned.reviewRequired, true);
  assert.throws(() => alignStoryNarration("El motor perdió combustible mientras viajábamos por la carretera.", { segments: [{ text, startTime: 0, endTime: 5, words }] }, 5), /no coinciden/);
  assert.throws(() => alignStoryNarration("La calma no cuenta cuando buscas un nuevo camino.", { segments: [{ text, startTime: 0, endTime: 5, words }] }, 5), /negación/);
});

test("voice status does not claim the neural voice is installed from a requested name alone", () => {
  assert.equal(getNarrationVoiceStatus({ CLIPFORGE_LOCAL_TTS_COMMAND: "/missing/piper", CLIPFORGE_LOCAL_TTS_MODEL_PATH: "/missing/voice" }).neuralReady, false);
  assert.equal(getNarrationVoiceStatus({}).uploadAvailable, true);
});

test("a word split into two recognized tokens retains its measured span and complete ending", () => {
  const text = "La calma nos ayuda a contemplar un nuevo a manecer.";
  const words = text.split(" ").map((text, index) => ({ text, startTime: index * 0.5, endTime: index * 0.5 + 0.4 }));
  const aligned = alignStoryNarration("La calma nos ayuda a contemplar un nuevo amanecer.", { segments: [{ text, startTime: 0, endTime: 5, words }] }, 5);
  assert.equal(aligned.words.at(-1).mergedRecognitionTokens, true);
  assert.equal(aligned.words.at(-1).endTime, words.at(-1).endTime);
  assert.equal(aligned.wordErrorRate, 0);
});
