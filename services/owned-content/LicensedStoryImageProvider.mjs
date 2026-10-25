import { readFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { WaitingResourceError } from "./StoryProviderError.mjs";

const tokens = value => String(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z]{4,}/g) || [];
const same = (a, b) => a === b || (a.length >= 5 && b.length >= 5 && a.slice(0, 5) === b.slice(0, 5));

export function selectLicensedSceneImages(scenes, assets) {
  const used = new Set();
  return scenes.map(scene => {
    const words = tokens(scene.narration);
    const ranked = assets.filter(asset => asset.license === "CC0-1.0" && !used.has(asset.id)).map(asset => {
      const matches = asset.tags.filter(tag => tokens(tag).some(tagWord => words.some(word => same(word, tagWord))));
      return { asset, matches, score: matches.length };
    }).sort((a, b) => b.score - a.score || a.asset.id.localeCompare(b.asset.id));
    const selected = ranked[0];
    if (!selected?.score) throw new WaitingResourceError(`La biblioteca de naturaleza no tiene una imagen relacionada para la escena ${scene.order}. Ajusta el texto o utiliza imágenes propias.`);
    used.add(selected.asset.id);
    return { ...selected, method: "SPANISH_TAG_MATCH", reviewRequired: true };
  });
}

/** A small licensed photo library, not an image generator or vision model. */
export class LicensedStoryImageProvider {
  name = "cc0-nature-library";
  constructor(options = {}) { this.directory = options.directory || path.join(process.cwd(), "public", "story-library"); }
  async prepare(plan) {
    const manifest = JSON.parse(await readFile(path.join(this.directory, "manifest.json"), "utf8"));
    const selected = selectLicensedSceneImages(plan.scenes, manifest.assets);
    return Promise.all(selected.map(async ({ asset, matches, method }) => {
      if (!/^[a-z-]+\.(jpg|png)$/.test(asset.file)) throw new Error("Archivo de biblioteca inválido.");
      const filename = path.join(this.directory, asset.file), bytes = await readFile(filename);
      const hash = createHash("sha256").update(bytes).digest("hex");
      if (hash !== asset.sha256) throw new Error("La fotografía cambió; verifica su procedencia antes de usarla.");
      const relativePath = `story-assets/${hash}${path.extname(asset.file)}`;
      const target = resolveStoragePath(relativePath); await mkdir(path.dirname(target), { recursive: true }); await copyFile(filename, target);
      return { filename: target, relativePath, provider: this.name, credit: { id: asset.id, sourcePage: asset.sourcePage, license: asset.license, licenseUrl: asset.licenseUrl, artist: asset.artist }, selection: { method, matchedTags: matches, reviewRequired: true } };
    }));
  }
}
