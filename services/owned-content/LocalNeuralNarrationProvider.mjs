import { spawnMediaProcess as spawn } from "../../lib/media-execution.mjs";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import { WaitingResourceError } from "./StoryProviderError.mjs";

export function getNarrationVoiceStatus(env = process.env) {
  const command = env.CLIPFORGE_LOCAL_TTS_COMMAND?.trim();
  const model = env.CLIPFORGE_LOCAL_TTS_MODEL_PATH?.trim();
  const voices = env.CLIPFORGE_LOCAL_TTS_VOICES_PATH?.trim();
  return { neuralReady: Boolean(command && model && voices && existsSync(command) && existsSync(model) && existsSync(voices)),
    uploadAvailable: true, basicVoice: "eSpeak básica; revisar antes de entregar" };
}

/** Optional local CLI: no remote calls, voice cloning, paid fallback or shell. */
export class LocalNeuralNarrationProvider {
  name = "kokoro-local";
  constructor(options = {}) {
    this.command = options.command || process.env.CLIPFORGE_LOCAL_TTS_COMMAND?.trim();
    this.model = options.model || process.env.CLIPFORGE_LOCAL_TTS_MODEL_PATH?.trim();
    this.voices = options.voices || process.env.CLIPFORGE_LOCAL_TTS_VOICES_PATH?.trim();
    this.voice = "ef_dora";
    const pace = Number(options.lengthScale ?? 1.2);
    this.speed = Number.isFinite(pace) ? Math.max(0.8, Math.min(1.5, pace)) : 1.2;
  }
  async identity() {
    if (!this.command || !this.model || !this.voices) throw new WaitingResourceError("La voz local Kokoro no está instalada. Configura el worker o sube tu propia narración.");
    const model = await stat(this.model), voices = await stat(this.voices);
    return { model: this.model, size: model.size, modified: model.mtimeMs, voicesModified: voices.mtimeMs, lengthScale: this.speed };
  }
  async synthesize({ text, outputPath }) {
    await this.identity();
    if (!String(text || "").trim() || String(text).length > 12000) throw new Error("Texto de narración inválido.");
    await mkdir(path.dirname(outputPath), { recursive: true });
    await new Promise((resolve, reject) => {
      const child = spawn(this.command, ["--model", this.model, "--voices", this.voices, "--output_file", outputPath, "--length_scale", String(this.speed), "--sentence_silence", "0.18", "--quiet"], { shell: false, stdio: ["pipe", "ignore", "pipe"] });
      let stderr = "", settled = false;
      const finish = error => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else resolve(); };
      const timer = setTimeout(() => { child.kill("SIGKILL"); finish(new Error("La voz local excedió el tiempo máximo.")); }, 120000);
      child.stderr.setEncoding("utf8"); child.stderr.on("data", part => { stderr = (stderr + part).slice(-3000); });
      child.on("error", () => finish(new WaitingResourceError("No se pudo iniciar la voz local. Revisa su instalación o utiliza una narración grabada.")));
      child.stdin.on("error", () => {});
      child.on("close", code => finish(code === 0 ? null : new Error(stderr || "La voz local no produjo una narración válida.")));
      child.stdin.end(`${String(text).replace(/\s+/g, " ").trim()}\n`);
    });
  }
}
