import { mkdir, writeFile, readFile, stat, rename } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { replaceProjectFile } from "../../lib/project-files.mjs";
import { EspeakNewsTtsProvider } from "../news/EspeakNewsTtsProvider.mjs";
import { runMedia, validateMp4, probeMediaFile } from "../media-processing/MediaValidationService.mjs";
import { hashFile } from "../ingest/ResumableUploadStore.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
import { WaitingResourceError } from "./StoryProviderError.mjs";
import { createStoryGenerationProviders, storyPlanSignature } from "./StoryGenerationProviders.mjs";
export { WaitingResourceError } from "./StoryProviderError.mjs";

/** Providers must return actual, authorized files; missing scenes never become color fields. */
export class LocalImageProvider {
  name = "user-authorized-images";
  async resolve(scene, input) {
    const relativePath = input.images?.[scene.order - 1];
    if (!relativePath) throw new WaitingResourceError(`Falta la imagen de la escena ${scene.order}. Sube una imagen propia o configura un proveedor autorizado.`);
    if (!/^story-assets\/[a-f0-9-]+\.(png|jpg|webp)$/.test(relativePath)) throw new Error("Ruta de imagen no autorizada.");
    const filename = resolveStoragePath(relativePath); const info = await stat(filename);
    if (!info.isFile() || info.size <= 0) throw new WaitingResourceError(`La imagen ${scene.order} no está disponible.`);
    const probe = await probeMediaFile(filename);
    if (!probe.video?.width || probe.video.width > 6000 || probe.video.height > 6000 || probe.video.width*probe.video.height>12_000_000) throw new Error("Imagen inválida o demasiado grande. Utiliza una imagen de hasta doce megapíxeles.");
    return { filename, relativePath, provider: this.name };
  }
}

// An original local narrative for the mandatory example, honestly identified as
// authored template rather than output of an unavailable language model.
export const MAYA_NARRATION = [
  "Durante siglos, la selva ocultó una ciudad que nadie encontraba. Al amanecer, una exploradora vio una pirámide entre la niebla y decidió seguir el río.",
  "Bajo las raíces descubrió escalones de piedra. Cada peldaño llevaba una marca distinta. Cuando apareció el símbolo del jaguar, el bosque quedó extrañamente silencioso.",
  "Una puerta cubierta de musgo protegía el templo. La exploradora acercó su antorcha. En los relieves encontró un mapa que señalaba un camino bajo el agua.",
  "Al cruzar la entrada, llegó a una cámara iluminada por reflejos turquesa. No había tesoros. Solo columnas, un pequeño estanque y las huellas de antiguos visitantes.",
  "Entonces, un rayo de sol reveló el secreto del mapa. La ciudad había guardado conocimientos sobre los ríos y las estrellas, destinados a quienes supieran escuchar.",
  "La exploradora salió mientras amanecía sobre las terrazas. Comprendió que descubrir aquel lugar no significaba poseerlo. Registró el camino y prometió proteger su historia junto a las comunidades de la región.",
];

export async function planStory(input, options = {}) {
  const duration = Number(input.duration ?? 60);
  if (!Number.isFinite(duration) || duration < 15 || duration > 300) throw new Error("Elige una duración entre 15 y 300 segundos.");
  const sceneCount = Number(input.sceneCount ?? 6);
  if (!Number.isSafeInteger(sceneCount) || sceneCount < 6 || sceneCount > 12) throw new Error("Elige entre seis y doce escenas.");
  let texts, provider, generated;
  if (String(input.narration || "").trim().split(/\s+/).length >= 60) {
    const sentences = String(input.narration).trim().split(/(?<=[.!?])\s+/);
    if (sentences.length < sceneCount) throw new WaitingResourceError(`Divide el relato en al menos ${sceneCount} frases para crear ${sceneCount} escenas.`);
    texts = Array.from({ length: sceneCount }, (_, i) => sentences.slice(Math.floor(i * sentences.length / sceneCount), Math.floor((i + 1) * sentences.length / sceneCount)).join(" ")); provider = "user-script";
  } else if (options.scriptProvider?.generate) {
    if (options.scriptProvider.requiresPayment && options.scriptProvider.authorized !== true) throw new WaitingResourceError("El proveedor de guion requiere autorización de costo en el servidor. Puedes pegar un relato completo sin costo.");
    generated = await options.scriptProvider.generate({ ...input, sceneCount }); texts = generated.scenes?.map(s => s.narration); provider = options.scriptProvider.name;
  } else if (input.example === "MAYA_LEGACY" && sceneCount === 6) {
    texts = duration < 45 ? ["Al amanecer, una exploradora descubre una pirámide entre la niebla.","Bajo las raíces, un símbolo del jaguar señala una puerta.","La luz de su antorcha revela un mapa tallado.","Tras el umbral, encuentra un estanque y columnas antiguas.","Un rayo de sol ilumina conocimientos sobre ríos y estrellas.","La exploradora registra el hallazgo y promete proteger la ciudad."] : MAYA_NARRATION; provider = "local-original-maya-story";
  } else throw new WaitingResourceError("No hay un modelo de guion autorizado configurado para este tema. Pega un relato completo de al menos 60 palabras o configura un proveedor autorizado.");
  if (!Array.isArray(texts) || texts.length !== sceneCount || texts.some(t => typeof t !== "string" || !t.trim())) throw new Error("El proveedor debe devolver la cantidad solicitada de escenas completas.");
  const totalWords = texts.reduce((n, t) => n + t.split(/\s+/).length, 0);
  const maya=provider==="local-original-maya-story";
  const manifest = { style: String(input.style || "cinematográfico"), language: "es-419", palette: String(input.palette||generated?.palette||(maya?"verde esmeralda, piedra cálida, luz dorada":"Conservar la paleta de los recursos originales")), era: String(input.era||(maya?"ruinas mayas antiguas, exploración contemporánea":"Según el relato y las imágenes proporcionadas")), character: String(input.character||generated?.character||(maya?"exploradora con camisa beige y bolso de cuero":"Conservar los personajes de las imágenes proporcionadas")), continuityLimit: "El manifiesto mantiene una descripción común; la identidad visual debe revisarse y no se garantiza continuidad perfecta." };
  const scenes = texts.map((narration, i) => ({ id: `scene-${i + 1}`, order: i + 1, narration,
    visualDescription: generated?.scenes[i]?.visualDescription || `${input.topic || "Historia"}. Escena ${i + 1}: ${narration}. Estilo: ${manifest.style}.`,
    estimatedDuration: duration * narration.split(/\s+/).length / totalWords,
    movement: ["zoom-in", "pan-right", "zoom-out", "pan-up", "pan-left", "zoom-in"][i % 6], transition: i === texts.length - 1 ? "none" : "fade" }));
  return { title: String(input.title || generated?.title || input.topic || "Historia visual").slice(0, 120), duration, provider, manifest, scenes };
}

export class SceneStoryService {
  constructor(options = {}) {
    const configured = createStoryGenerationProviders(options);
    this.localImages = new LocalImageProvider();
    this.images = options.imageProvider || configured.imageProvider || this.localImages;
    this.scriptProvider = options.scriptProvider || configured.scriptProvider;
    this.tts = options.ttsProvider || new EspeakNewsTtsProvider({ voice: "es-419", speed: 165 });
    this.width = options.width || Number(process.env.CLIPFORGE_MEDIA_WIDTH || 1080); this.height = options.height || Number(process.env.CLIPFORGE_MEDIA_HEIGHT || 1920);
  }
  async render(projectId, input, onStage = async () => {}) {
    if (!isProjectId(projectId)) throw new Error("Proyecto de historia inválido.");
    if (input.format && !["9:16", "16:9"].includes(input.format)) throw new Error("Formato inválido.");
    const scriptProvider = input.generationMode === "AI" ? this.scriptProvider : undefined;
    if (input.generationMode === "AI" && this.images === this.localImages && !input.images?.length) throw new WaitingResourceError("La generación IA de imágenes todavía no está configurada. No se consumirá el proveedor de guion.");
    if (input.generationMode === "AI" && this.images.requiresPayment) {
      const config = this.images.config;
      const scriptCost = String(input.narration || "").trim().split(/\s+/).length >= 60 ? 0 : config.scriptMaxCostUsd;
      if (!config.authorized || !config.imageUnitCostUsd || !config.maxCostUsd || scriptCost === null || (Number(input.sceneCount ?? 6) * config.imageUnitCostUsd + scriptCost) > config.maxCostUsd) throw new WaitingResourceError("Los proveedores y el presupuesto deben estar autorizados antes de iniciar esta historia.");
    }
    const directory = path.join(getStorageRoot(), "stories", projectId); await mkdir(directory, { recursive: true });
    const signature = storyPlanSignature(input, `${scriptProvider?.name || "user-script"}:${scriptProvider?.config?.scriptModel || ""}`);
    const planFile = path.join(directory, "plan.json");
    const cached = await readFile(planFile, "utf8").then(JSON.parse).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    const plan = cached?.signature === signature ? cached.plan : await planStory({ ...input, projectId }, { scriptProvider });
    if (cached?.signature !== signature) {
      const temporary = `${planFile}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify({ signature, plan }), { flag: "wx" }); await rename(temporary, planFile);
    }
    let width = this.width, height = this.height;
    if (input.format === "16:9") [width, height] = [height, width];
    const resolved = [];
    await onStage("PROCESSING", "IMAGES", 0);
    for (const scene of plan.scenes) {
      const image = input.images?.[scene.order - 1] ? await this.localImages.resolve(scene, input) : await this.images.resolve(scene, { ...input, projectId }, plan.manifest);
      // Generated files receive the same probe/dimension checks as own images.
      if (image.provider !== this.localImages.name) await this.localImages.resolve(scene, { images: Array.from({ length: plan.scenes.length }, (_, i) => i === scene.order - 1 ? image.relativePath : undefined) });
      resolved.push(image); await onStage("PROCESSING", "IMAGES", 0);
    }
    const imageHashes = await Promise.all(resolved.map(async r => createHash("sha256").update(await readFile(r.filename)).digest("hex")));
    if (new Set(imageHashes).size !== plan.scenes.length) throw new WaitingResourceError("Cada escena necesita una imagen diferente. Corrige los recursos repetidos; no se sustituirán por fondos vacíos.");
    const voiceSegments = [], cues = []; let rawDuration = 0,reusedVoiceSegments=0,reusedScenes=0;
    await onStage("PROCESSING", "NARRATION", 0);
    for (const scene of plan.scenes) {
      scene.audioStart = rawDuration;
      for (const text of captionPhrases(scene.narration)) {
        const filename = path.join(directory, `voice-${voiceSegments.length}.wav`);
        try { if(await reuseVerifiedStage(filename,{text,provider:this.tts.name,voice:this.tts.voice,speed:this.tts.speed},()=>this.tts.synthesize({ text, outputPath: filename })))reusedVoiceSegments++; }
        catch (error) { if (/not installed|ENOENT|configured/i.test(error.message)) throw new WaitingResourceError("La voz local en español no está disponible. Instala/configura eSpeak en el worker o proporciona un proveedor autorizado."); throw error; }
        const duration = (await probeMediaFile(filename)).duration;
        if (!(duration > 0)) throw new Error("El proveedor de voz no produjo audio válido.");
        voiceSegments.push(filename); cues.push({ text, startTime: rawDuration, endTime: rawDuration + duration }); rawDuration += duration;
      }
      scene.audioEnd = rawDuration;
      await onStage("PROCESSING", "NARRATION", Math.round(scene.order / plan.scenes.length * 30));
    }
    const tempo = rawDuration / plan.duration;
    if (tempo < 0.65 || tempo > 1.6) throw new WaitingResourceError("La narración no cabe de forma natural en esa duración. Ajusta el relato o la duración solicitada.");
    for (const cue of cues) { cue.startTime /= tempo; cue.endTime /= tempo; }
    for (const scene of plan.scenes) { scene.startTime = scene.audioStart / tempo; scene.duration = (scene.audioEnd - scene.audioStart) / tempo; }
    const audioList = path.join(directory, "audio.txt");
    await writeFile(audioList, voiceSegments.map(filename => `file '${path.basename(filename)}'`).join("\n"));
    const narration = path.join(directory, "narration.wav");
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "1", "-i", audioList, "-af", `atempo=${tempo.toFixed(6)},loudnorm=I=-16:TP=-1.5:LRA=11,apad`, "-t", String(plan.duration), "-ar", "48000", "-c:a", "pcm_s16le", narration]);
    const transition = 0.35, parts = [];
    for (let i = 0; i < plan.scenes.length; i++) {
      const scene = plan.scenes[i], filename = path.join(directory, `scene-${i}.mp4`);
      const seconds = scene.duration + (i < plan.scenes.length - 1 ? transition : 0);
      const frames = Math.ceil(seconds * 30);
      if(await reuseVerifiedStage(filename,{image:imageHashes[i],movement:scene.movement,frames,width,height,seconds},()=>runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-filter_threads", "1", "-i", resolved[i].filename, "-vf", buildSceneMotion(scene.movement, frames, width, height), "-t", String(seconds), "-an", "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-pix_fmt", "yuv420p", "-r", "30", filename])))reusedScenes++;
      parts.push(filename); await onStage("PROCESSING", "SCENES", 30 + Math.round((i + 1) / plan.scenes.length * 35));
    }
    // Join two decoders at a time to keep 1080p rendering within a small worker's memory.
    let joined = parts[0], offset = 0;
    for (let i = 1; i < parts.length; i++) {
      offset += plan.scenes[i - 1].duration;
      const next = path.join(directory, `joined-${i}.mp4`);
      await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v","error","-y","-filter_complex_threads","1","-threads","1","-i",joined,"-threads","1","-i",parts[i],"-filter_complex",`[0:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[a];[1:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[b];[a][b]xfade=transition=fade:duration=${transition}:offset=${offset.toFixed(6)}[out]`,"-map","[out]","-an","-c:v","libx264","-threads","2","-preset","fast","-crf","20","-pix_fmt","yuv420p",next]);
      joined = next;
    }
    const graph = ["[0:v]fps=30,settb=AVTB,setpts=PTS-STARTPTS,format=yuv420p[visual]"];
    const current = "visual";
    const ass = path.join(directory, "subtitles.ass"); await writeFile(ass, storyAss(cues, width, height));
    const finalLabel = input.subtitles === false ? current : "captioned";
    if (input.subtitles !== false) graph.push(`[${current}]ass='${filterPath(ass)}'[${finalLabel}]`);
    const args = ["-v", "error", "-y", "-filter_complex_threads", "1", "-threads","1","-i", joined, "-i", narration];
    let audioMap = "1:a:0";
    if (input.music) {
      if (!/^story-assets\/[a-f0-9-]+\.(wav|mp3|m4a)$/.test(input.music)) throw new Error("Recurso de música no autorizado.");
      args.push("-stream_loop", "-1", "-i", resolveStoragePath(input.music));
      graph.push(`[1:a]asplit=2[voice][side];[2:a]volume=0.12,afade=t=in:d=1,afade=t=out:st=${plan.duration - 1}:d=1[music];[music][side]sidechaincompress=threshold=0.03:ratio=10:attack=20:release=400[ducked];[voice][ducked]amix=inputs=2:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[mixed]`); audioMap = "[mixed]";
    }
    const temporary = path.join(directory, "render.partial.mp4"), finalPath = path.join(directory, "render.mp4");
    args.push("-filter_complex", graph.join(";"), "-map", `[${finalLabel}]`, "-map", audioMap, "-t", String(plan.duration), "-c:v", "libx264", "-threads", "2", "-preset", "fast", "-crf", "23", "-pix_fmt", "yuv420p", "-r", "30", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", temporary);
    await onStage("PROCESSING", "ASSEMBLY", 65); await runMedia(process.env.FFMPEG_PATH || "ffmpeg", args);
    await onStage("VALIDATING", "MEDIA_VALIDATION", 95);
    const validation = await validateMp4(temporary, { requireAudio: true, requireAudibleNarration:true, duration: plan.duration, width, height, subtitleValidation: input.subtitles === false ? "NOT_REQUESTED" : "ASS_BURNED_WITH_MEASURED_VOICE_SEGMENTS" });
    await rename(temporary, finalPath);
    const posterDir = path.join(getStorageRoot(), "uploads", projectId); await mkdir(posterDir, { recursive: true });
    await runMedia(process.env.FFMPEG_PATH || "ffmpeg", ["-v", "error", "-y", "-ss", "1", "-i", finalPath, "-frames:v", "1", path.join(posterDir, "poster.jpg")]);
    const clipId = randomUUID(), relativePath = path.posix.join("stories", projectId, "render.mp4"), sourceUrl = `/api/projects/${projectId}/clips/${clipId}/source`;
    const now = new Date().toISOString();
    plan.recovery={reusedVoiceSegments,reusedScenes};
    const render = { relativePath, sourceUrl, width, height, codec: "h264", container: "mp4", sizeBytes: validation.sizeBytes, validation, subtitlesBurned: input.subtitles !== false, autoReframeApplied: false };
    const project = { id: projectId, createdAt: now, source: { projectId, originalName: `${plan.title}.mp4`, storedName: "render.mp4", relativePath, sourceUrl, posterUrl: `/api/projects/${projectId}/poster`, sizeBytes: validation.sizeBytes, durationSeconds: validation.duration, width, height, fps: 30, codec: "h264", container: "mp4", aspectRatio: input.format || "9:16", hasAudio: true },
      story: { ...plan, imageProvider: this.images.name, subtitleCues: cues }, clips: [{ id: clipId, projectId, candidateId: "story", startTime: 0, endTime: validation.duration, duration: validation.duration, status: "READY", render, edit: { framingMode: "FIT", subtitlesEnabled: input.subtitles !== false, subtitleStyle: "CLEAN", quality: "BALANCED" }, createdAt: now, updatedAt: now, error: null }] };
    await replaceProjectFile(projectId, project); await writeFile(path.join(directory, "manifest.json"), JSON.stringify({ plan, validation, cues }, null, 2));
    return { projectId, clipId, relativePath, sourceUrl, downloadUrl: `${sourceUrl}?download=1`, validation, recovery:plan.recovery,title: plan.title };
  }
}

export function buildSceneMotion(movement, frames, width, height) {
  if (![frames, width, height].every(Number.isSafeInteger) || frames < 2 || width < 144 || height < 144 || width > 3840 || height > 3840 || width % 2 || height % 2) throw new Error("Parámetros de movimiento inválidos.");
  const fraction = `min(on/${frames - 1},1)`, centerX = "(iw-iw/zoom)/2", centerY = "(ih-ih/zoom)/2";
  let z = `1+0.08*${fraction}`, x = centerX, y = centerY;
  if (movement === "zoom-out") z = `1.08-0.08*${fraction}`;
  if (movement === "pan-right") { z = "1.08"; x = `(iw-iw/zoom)*${fraction}`; }
  if (movement === "pan-left") { z = "1.08"; x = `(iw-iw/zoom)*(1-${fraction})`; }
  if (movement === "pan-up") { z = "1.08"; y = `(ih-ih/zoom)*(1-${fraction})`; }
  return `scale=${width * 2}:${height * 2}:force_original_aspect_ratio=increase,crop=${width * 2}:${height * 2},zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${width}x${height}:fps=30,setsar=1,format=yuv420p`;
}
function captionPhrases(text) {
  const words = String(text).split(/\s+/); const chunks = []; let current = [];
  for (const word of words) { if (current.join(" ").length + word.length > 60 && current.length) { chunks.push(current.join(" ")); current = []; } current.push(word); if (/[.!?]$/.test(word)) { chunks.push(current.join(" ")); current = []; } }
  if (current.length) chunks.push(current.join(" ")); return chunks;
}
function storyAss(cues, width, height) {
  const size = Math.max(18, Math.round(width * 0.045));
  const lines = ["[Script Info]", "ScriptType: v4.00+", `PlayResX: ${width}`, `PlayResY: ${height}`, "WrapStyle: 0", "[V4+ Styles]", "Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding", `Style: Default,DejaVu Sans,${size},&H00FFFFFF,&H00FFFFFF,&H00101010,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,30,30,${Math.round(height * 0.1)},1`, "[Events]", "Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text"];
  for (const cue of cues) lines.push(`Dialogue: 0,${assTime(cue.startTime)},${assTime(cue.endTime)},Default,,0,0,0,,${String(cue.text).replace(/[{}\\]/g, " ")}`);
  return lines.join("\n") + "\n";
}
function assTime(seconds) { const cs = Math.round(Math.max(0, seconds) * 100); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2,"0")}:${String(Math.floor(cs / 100) % 60).padStart(2,"0")}.${String(cs % 100).padStart(2,"0")}`; }
function filterPath(value) { return value.replaceAll("\\", "\\\\").replaceAll(":", "\\:").replaceAll("'", "\\'").replaceAll(",", "\\,").replaceAll("[", "\\[").replaceAll("]", "\\]"); }

async function reuseVerifiedStage(filename,request,build) {
  const requestHash=createHash("sha256").update(JSON.stringify(request)).digest("hex");
  try { const cache=JSON.parse(await readFile(`${filename}.cache.json`,"utf8"));if(cache.requestHash===requestHash&&cache.sha256===await hashFile(filename)&&(await probeMediaFile(filename)).duration>0)return true; } catch { /* An incomplete stage is rendered again from its authorized source. */ }
  await build();const probe=await probeMediaFile(filename);if(!(probe.duration>0))throw new Error("La etapa multimedia no produjo un archivo válido.");
  await writeFile(`${filename}.cache.json`,JSON.stringify({requestHash,sha256:await hashFile(filename),duration:probe.duration,completedAt:new Date().toISOString()}));
  return false;
}

