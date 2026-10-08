import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveOpenAICompatibleConfig, requestStructuredJson } from "../ai/OpenAICompatibleClient.mjs";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { leaseOwner, ownerIsAlive } from "../../lib/process-lease.mjs";
import { WaitingResourceError } from "./StoryProviderError.mjs";

const fingerprint = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null;

/** Configuration is server-side. A browser payload cannot authorize billing. */
export function storyProviderConfig(env = process.env) {
  return {
    authorized: env.CLIPFORGE_STORY_EXTERNAL_AUTHORIZED === "true",
    scriptEnabled: env.CLIPFORGE_STORY_SCRIPT_PROVIDER === "openai-compatible",
    imageEnabled: env.CLIPFORGE_STORY_IMAGE_PROVIDER === "openai-compatible",
    scriptModel: env.CLIPFORGE_STORY_SCRIPT_MODEL || env.CLIPFORGE_AI_MODEL || "",
    scriptKey: env.CLIPFORGE_AI_API_KEY || env.OPENAI_API_KEY || "",
    scriptBaseUrl: env.CLIPFORGE_AI_BASE_URL || env.OPENAI_BASE_URL || "https://api.openai.com/v1",
    imageModel: env.CLIPFORGE_STORY_IMAGE_MODEL || "",
    imageKey: env.CLIPFORGE_STORY_IMAGE_API_KEY || "",
    imageBaseUrl: (env.CLIPFORGE_STORY_IMAGE_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, ""),
    imageSize: env.CLIPFORGE_STORY_IMAGE_SIZE || "1024x1536",
    imageQuality: env.CLIPFORGE_STORY_IMAGE_QUALITY || "medium",
    imageUnitCostUsd: positive(env.CLIPFORGE_STORY_IMAGE_UNIT_COST_USD),
    scriptMaxCostUsd: positive(env.CLIPFORGE_STORY_SCRIPT_MAX_COST_USD),
    maxCostUsd: positive(env.CLIPFORGE_STORY_MAX_COST_USD),
  };
}

export function getStoryProviderStatus(env = process.env) {
  const config = storyProviderConfig(env);
  const budgetReady = config.authorized && config.maxCostUsd !== null;
  const scriptReady = Boolean(budgetReady && config.scriptEnabled && config.scriptModel && config.scriptKey && config.scriptMaxCostUsd);
  const imageReady = Boolean(budgetReady && config.imageEnabled && config.imageModel && config.imageKey && config.imageUnitCostUsd);
  const automaticReady = Boolean(scriptReady && imageReady && config.scriptMaxCostUsd + 6 * config.imageUnitCostUsd <= config.maxCostUsd);
  return { scriptReady, imageReady, automaticReady, maxCostUsd: config.maxCostUsd,
    message: automaticReady ? "Proveedores de guion e imágenes configurados y autorizados. Cada escena se genera por separado." : "Generación automática pendiente: faltan proveedores, autorización o presupuesto del servidor. Puedes crear una historia con tu relato y tus imágenes." };
}

export class StoryGenerationBudget {
  constructor(config, options = {}) { this.config = config; this.root = options.root || getStorageRoot(); }
  async reserve(projectId, kind) {
    const amount = kind === "image" ? this.config.imageUnitCostUsd : this.config.scriptMaxCostUsd;
    if (!this.config.authorized || !amount || !this.config.maxCostUsd) throw new WaitingResourceError("Generación externa desactivada: el propietario debe autorizar el proveedor y configurar su costo máximo.");
    if (!isProjectId(projectId)) throw new Error("Proyecto de historia inválido.");
    const directory = path.join(this.root, "stories", projectId); await mkdir(directory, { recursive: true });
    return budgetLock(directory, () => this.reserveLocked(directory, kind, amount));
  }
  async reserveLocked(directory, kind, amount) {
    const filename = path.join(directory, "external-budget.json");
    const previous = await readFile(filename, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return { reservedUsd: 0, requests: [] }; throw error; });
    const reservedUsd = Math.round((previous.reservedUsd + amount) * 1_000_000) / 1_000_000;
    if (reservedUsd > this.config.maxCostUsd) throw new WaitingResourceError("Se alcanzó el presupuesto autorizado de esta historia. No se harán más llamadas externas.");
    const next = { reservedUsd, limitUsd: this.config.maxCostUsd, requests: [...previous.requests, { kind, estimatedMaximumUsd: amount, at: new Date().toISOString() }],
      accounting: "Conservative operator-supplied estimates, including failed requests; actual vendor billing must be reconciled separately." };
    await saveJson(filename, next);
    return next;
  }
}

export class CompatibleStoryScriptProvider {
  name = "openai-compatible-story-script";
  requiresPayment = true;
  constructor(config, options = {}) {
    this.config = config; this.authorized = config.authorized;
    this.budget = options.budget || new StoryGenerationBudget(config);
    this.fetch = options.fetchImpl || globalThis.fetch;
  }
  async generate(input) {
    if (!this.config.scriptEnabled || !this.config.scriptModel || !this.config.scriptKey) throw new WaitingResourceError("No hay un proveedor de guion configurado.");
    await this.budget.reserve(input.projectId, "script");
    const count = input.sceneCount ?? 6;
    const config = resolveOpenAICompatibleConfig({ apiKey: this.config.scriptKey, baseUrl: this.config.scriptBaseUrl, model: this.config.scriptModel, maxOutputTokens: 4096 });
    const result = await requestStructuredJson({ config, name: "clipforge_story", fetchImpl: (url, init) => this.fetch(url, { ...init, redirect: "error", signal: AbortSignal.timeout(90_000) }),
      schema: { type: "object", additionalProperties: false, required: ["title", "character", "palette", "scenes"], properties: {
        title: { type: "string" }, character: { type: "string" }, palette: { type: "string" },
        scenes: { type: "array", minItems: count, maxItems: count, items: { type: "object", additionalProperties: false, required: ["narration", "visualDescription"], properties: { narration: { type: "string" }, visualDescription: { type: "string" } } } },
      } },
      instructions: `Escribe una historia original en español latinoamericano con exactamente ${count} escenas consecutivas. Debe tener inicio, desarrollo y final; no reutilices ejemplos. La narración completa durará aproximadamente ${input.duration || 60} segundos a 155 palabras por minuto. Cada escena necesita narración y una descripción visual concreta diferente. Define una descripción consistente del personaje y una paleta común. Respeta el tema y no incluyas texto sobreimpreso en las imágenes.`,
      input: { topic: String(input.topic || "").slice(0, 2000), style: input.style, duration: input.duration, sceneCount: count },
    });
    const value = result.parsed;
    if (value?.scenes?.length !== count || value.scenes.some(scene => typeof scene.narration !== "string" || !scene.narration.trim() || typeof scene.visualDescription !== "string" || !scene.visualDescription.trim())) throw new Error("El proveedor no devolvió las escenas completas solicitadas.");
    return value;
  }
}

export class CompatibleStoryImageProvider {
  name = "openai-compatible-generated-images";
  requiresPayment = true;
  constructor(config, options = {}) {
    this.config = config; this.root = options.root || getStorageRoot();
    this.budget = options.budget || new StoryGenerationBudget(config, { root: this.root });
    this.fetch = options.fetchImpl || globalThis.fetch;
  }
  async resolve(scene, input, manifest) {
    if (input.generationMode !== "AI") throw new WaitingResourceError("Selecciona generación IA o proporciona imágenes propias.");
    if (!isProjectId(input.projectId)) throw new Error("Proyecto de historia inválido.");
    if (!this.config.imageEnabled || !this.config.imageModel || !this.config.imageKey) throw new WaitingResourceError("No hay un proveedor de imágenes configurado.");
    const prompt = `${scene.visualDescription}. Continuidad: ${manifest.character}. Paleta: ${manifest.palette}. Estilo: ${manifest.style}. Escena ${scene.order}; composición propia, sin letras, subtítulos ni marcas de agua.`;
    const signature = fingerprint({ prompt, model: this.config.imageModel, size: this.config.imageSize, quality: this.config.imageQuality });
    const directory = path.join(this.root, "stories", input.projectId); await mkdir(directory, { recursive: true });
    const checkpoint = path.join(directory, `image-${scene.order}.json`);
    const cached = await readFile(checkpoint, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (cached?.signature === signature && /^story-assets\/[a-f0-9-]+\.(png|jpg|webp)$/.test(cached.relativePath)) {
      const filename = path.join(this.root, cached.relativePath);
      if ((await stat(filename).catch(() => null))?.size > 0 && createHash("sha256").update(await readFile(filename)).digest("hex") === cached.sha256) return { filename, relativePath: cached.relativePath, provider: this.name, reused: true };
    }
    const endpoint = new URL(`${this.config.imageBaseUrl}/images/generations`);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) throw new Error("El proveedor de imágenes necesita un endpoint HTTPS sin credenciales en la URL.");
    await this.budget.reserve(input.projectId, "image");
    const body = { model: this.config.imageModel, prompt, n: 1, size: this.config.imageSize, quality: this.config.imageQuality };
    if (!/^gpt-image/.test(this.config.imageModel)) body.response_format = "b64_json";
    const response = await this.fetch(endpoint.href, { method: "POST", redirect: "error", signal: AbortSignal.timeout(120_000), headers: { Authorization: `Bearer ${this.config.imageKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const result = await boundedJson(response);
    if (!response.ok) throw new Error(`El proveedor de imágenes devolvió HTTP ${response.status}. No se reintentará automáticamente.`);
    const encoded = result.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length > 12_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error("El proveedor no devolvió una imagen base64 válida dentro del límite. No se descargarán URLs externas sin validar.");
    const bytes = Buffer.from(encoded, "base64"); const extension = imageExtension(bytes);
    if (!extension || bytes.length > 8 * 1024 * 1024) throw new Error("El proveedor devolvió un archivo inválido o demasiado grande.");
    const relativePath = path.posix.join("story-assets", `${randomUUID()}.${extension}`);
    const filename = path.join(this.root, relativePath); await mkdir(path.dirname(filename), { recursive: true });
    const temporary = `${filename}.part`; await writeFile(temporary, bytes, { flag: "wx" }); await rename(temporary, filename);
    await saveJson(checkpoint, { signature, relativePath, sha256: createHash("sha256").update(bytes).digest("hex"), provider: this.name });
    return { filename, relativePath, provider: this.name, reused: false };
  }
}

export function createStoryGenerationProviders(options = {}) {
  const config = options.config || storyProviderConfig();
  const budget = new StoryGenerationBudget(config, options);
  return {
    scriptProvider: config.scriptEnabled ? new CompatibleStoryScriptProvider(config, { ...options, budget }) : undefined,
    imageProvider: config.imageEnabled ? new CompatibleStoryImageProvider(config, { ...options, budget }) : undefined,
  };
}
export function storyPlanSignature(input, providerName) {
  return fingerprint({ topic: input.topic, narration: input.narration, sceneCount: input.sceneCount ?? 6, duration: input.duration ?? 60, style: input.style, character: input.character, palette: input.palette, era: input.era, title: input.title, providerName });
}
async function saveJson(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value), { flag: "wx", mode: 0o600 }); await rename(temporary, filename);
}
async function boundedJson(response) {
  if (Number(response.headers?.get("content-length")) > 16_000_000) throw new Error("La respuesta del proveedor es demasiado grande.");
  if (!response.body) return response.json(); // Injectable test transports.
  const chunks = []; let size = 0;
  for await (const chunk of response.body) { size += chunk.byteLength; if (size > 16_000_000) throw new Error("La respuesta del proveedor es demasiado grande."); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
function imageExtension(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "jpg";
  if (bytes.subarray(0, 4).toString() === "RIFF" && bytes.subarray(8, 12).toString() === "WEBP") return "webp";
  return null;
}
async function budgetLock(directory, operation) {
  const filename = path.join(directory, "budget.lock");
  let handle;
  try { handle = await open(filename, "wx"); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = await readFile(filename, "utf8").then(JSON.parse).catch(() => null);
    if (owner && !ownerIsAlive(owner)) {
      // Serialize recovery so two observers cannot remove a new owner's lock.
      const recovery = `${filename}.recover`; let reclaim;
      try { reclaim = await open(recovery, "wx"); }
      catch (claimError) { if (claimError.code === "EEXIST") throw new WaitingResourceError("Presupuesto ocupado; reintenta cuando termine el trabajo activo."); throw claimError; }
      try {
        const current = await readFile(filename, "utf8").then(JSON.parse).catch(() => null);
        if (current && !ownerIsAlive(current)) await rm(filename, { force: true });
        return await budgetLock(directory, operation);
      } finally { await reclaim.close(); await rm(recovery, { force: true }); }
    }
    throw new WaitingResourceError("Presupuesto ocupado; no se iniciará otra llamada externa.");
  }
  try { await handle.writeFile(JSON.stringify(leaseOwner())); return await operation(); }
  finally { await handle.close(); await rm(filename, { force: true }); }
}
