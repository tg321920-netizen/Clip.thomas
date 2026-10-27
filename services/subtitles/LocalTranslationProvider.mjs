import path from "node:path";
import { spawnMediaProcess } from "../../lib/media-execution.mjs";
import { prepareTranslationInput, recoverTranslation, TRANSLATION_PIPELINE_VERSION } from './TranslationQualityService.mjs';

/** Optional offline CPU translator. Never downloads a model or calls a paid API. */
export class LocalTranslationProvider {
  constructor({ env = process.env } = {}) { this.env = env; }
  assertConfigured() {
    const python = this.env.CLIPFORGE_TRANSLATION_PYTHON;
    const model = this.env.CLIPFORGE_TRANSLATION_MODEL_PATH;
    if (!python || !model) throw Object.assign(new Error("La traducción local inglés-español no está configurada. Puedes usar subtítulos originales o editar el recorte sin subtítulos."), { code: "TRANSLATION_NOT_CONFIGURED" });
    return { python, model };
  }
  async translate(texts, { contexts = [], glossary = [] } = {}) {
    if (!Array.isArray(texts) || !texts.length || texts.length > 250) throw new Error('Cantidad de traducciones fuera de límite.');
    const prepared = texts.map((text,index) => prepareTranslationInput(text, contexts[index], glossary));
    const inputs = prepared.flatMap(item => item.contextual ? [item.direct, item.contextual] : [item.direct]);
    const result = await this.translateRaw(inputs);
    let offset = 0;
    const units = prepared.map(item => recoverTranslation(item, result.texts[offset++], item.contextual ? result.texts[offset++] : undefined));
    return { ...result, texts: units.map(unit=>unit.text), units, pipelineVersion: TRANSLATION_PIPELINE_VERSION };
  }
  async translateRaw(texts) {
    const { python, model } = this.assertConfigured();
    if (!Array.isArray(texts) || !texts.length || texts.length > 500 || texts.some(text => typeof text !== "string" || !text.trim() || text.length > 1000)) throw new Error("Texto de traducción fuera de los límites permitidos.");
    return new Promise((resolve, reject) => {
      const child = spawnMediaProcess(python, [path.resolve("scripts/translate-subtitles.py"), model], {
        shell: false, stdio: ["pipe", "pipe", "ignore"],
        env: { ...this.env, HF_HUB_OFFLINE: "1", OMP_NUM_THREADS: "1" },
      });
      const chunks = []; let bytes = 0, failure;
      const stop = code => { failure = code; child.kill("SIGKILL"); };
      const timer = setTimeout(() => stop("TRANSLATION_TIMEOUT"), 120_000);
      child.stdout.on("data", chunk => { bytes += chunk.length; if (bytes > 250_000) stop("TRANSLATION_OUTPUT_LIMIT"); else chunks.push(chunk); });
      child.stdin.on("error", () => {});
      child.once("error", () => { clearTimeout(timer); reject(Object.assign(new Error("No se pudo iniciar el traductor local. Revisa el entorno del servidor."), { code: "TRANSLATION_UNAVAILABLE" })); });
      child.once("close", code => {
        clearTimeout(timer);
        if (code !== 0 || failure) return reject(Object.assign(new Error("El traductor local no terminó correctamente. El original y los subtítulos previos se conservan."), { code: failure || "TRANSLATION_FAILED" }));
        try {
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!Array.isArray(value.translations) || value.translations.length !== texts.length || value.translations.some(text => typeof text !== "string" || !text.trim() || text.length > 1800) || !/^[a-f0-9]{64}$/.test(value.modelSha256)) throw new Error();
          resolve({ texts: value.translations, provider: "ctranslate2-cpu-local", modelSha256: value.modelSha256 });
        } catch { reject(Object.assign(new Error("El traductor devolvió una respuesta inválida; no se aceptaron subtítulos inventados."), { code: "TRANSLATION_INVALID" })); }
      });
      child.stdin.end(JSON.stringify({ source: "en", target: "es", texts }));
    });
  }
}
