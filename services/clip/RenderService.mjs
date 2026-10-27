import { mkdir, stat, writeFile, rename, readFile } from "node:fs/promises";
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import path from "node:path";
import { spawnMediaProcess as spawn } from "../../lib/media-execution.mjs";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { buildSpeechZoomFilter } from "../reframe/AutoReframeService.mjs";
import { validateMp4, probeMediaFile } from "../media-processing/MediaValidationService.mjs";
import { buildAssDocument } from "../subtitles/SubtitleService.mjs";
import {ENCODER_QUALITY,renderThreads} from '../../lib/render-options.mjs';
import {withRenderCapacity} from '../../lib/render-capacity.mjs';
import {withLocalStateLock,writeAtomicJson} from '../../lib/atomic-local-state.mjs';

const QUALITY=ENCODER_QUALITY;
async function sha256(file){const hash=createHash('sha256');for await(const chunk of createReadStream(/* turbopackIgnore: true */ file))hash.update(chunk);return hash.digest('hex');}

export class RenderService {
  constructor(options = {}) { this.width = options.width || 1080; this.height = options.height || 1920; assertResolution(this.width,this.height); }
  async renderClip(input){
    const guard=path.join(getStorageRoot(),'clips',input.project.id,input.clip.id,'render-state');
    return withLocalStateLock(guard,()=>withRenderCapacity(()=>this.renderUnlocked(input)),{timeoutMs:1000,staleMs:0});
  }
  async renderUnlocked({
    project,
    clip,
    onProgress = () => undefined,
  }) {
    const sourcePath = resolveStoragePath(project?.source?.relativePath);
    const outputDir = path.join(
      getStorageRoot(),
      "clips",
      project.id,
      clip.id,
    );
    const outputPath = path.join(outputDir, "render.mp4");
    const temporaryPath = path.join(outputDir, "render.partial.mp4");
    const proofPath=path.join(outputDir,'render-proof.json');

    await mkdir(outputDir, { recursive: true });

    const duration = Number(clip.duration);
    const startTime = Number(clip.startTime);

    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error("Clip duration is invalid.");
    }
    if (!Number.isFinite(startTime) || startTime < 0) {
      throw new Error("Clip startTime is invalid.");
    }

    const quality = QUALITY[clip?.edit?.quality] || QUALITY.BALANCED;
    const sourceInfo=await stat(sourcePath);
    const inputFingerprint=createHash('sha256').update(JSON.stringify({
      version:1,sourceSha256:await sha256(sourcePath),startTime,duration,width:this.width,height:this.height,
      edit:clip.edit,subtitles:clip.subtitles,autoReframe:clip.autoReframe,quality,
    })).digest('hex');
    const requireAudio = project.source.hasAudio ?? Boolean((await probeMediaFile(sourcePath)).audio);
    // A process may die after the MP4 was validated but before project state
    // became READY. Bind reuse to actual source bytes and all editing settings.
    let savedProof;try{savedProof=JSON.parse(await readFile(/* turbopackIgnore: true */ proofPath,'utf8'));}catch{}
    if(savedProof?.inputFingerprint===inputFingerprint&&/^[a-f0-9]{64}$/.test(savedProof.sha256)){
      for(const file of [outputPath,temporaryPath]){
        try{
          if(await sha256(file)!==savedProof.sha256)continue;
          const validation=await validateMp4(file,{requireAudio,duration,width:this.width,height:this.height,allowDarkVideo:project.allowDarkVideo});
          if(file!==outputPath)await rename(file,outputPath);
          onProgress(100);
          return this.renderRecord(project,clip,validation,savedProof,true);
        }catch(error){if(error.code==='ABORT_ERR')throw error;}
      }
    }
    const postFilters = ["fps=30", "setpts=PTS-STARTPTS"];
    if (clip?.edit?.motionIntensity) {
      postFilters.push(buildSafeMotionFilter(clip.edit.motionIntensity, this.width, this.height));
    }
    let subtitlesBurned = false;
    let autoReframeApplied = false;
    if(clip?.edit?.subtitlesEnabled&&(!clip?.subtitles?.enabled||!clip.subtitles.cues?.length))throw new Error("Se solicitaron subtítulos, pero no existen tiempos y textos válidos para este clip.");

    if (
      clip?.edit?.autoReframeEnabled &&
      clip?.autoReframe?.enabled
    ) {
      const reframeFilter = buildSpeechZoomFilter(
        clip.autoReframe,
        project?.source?.fps,
      );

      if (reframeFilter) {
        postFilters.push(reframeFilter);
        autoReframeApplied = true;
      }
    }

    if (
      clip?.edit?.subtitlesEnabled &&
      clip?.subtitles?.enabled &&
      Array.isArray(clip?.subtitles?.cues) &&
      clip.subtitles.cues.length > 0
    ) {
      const assPath = path.join(outputDir, "subtitles.ass");
      await writeFile(assPath, buildAssDocument(clip.subtitles, { width: this.width, height: this.height }), "utf8");
      postFilters.push(`ass='${escapeFilterPath(assPath)}'`);
      subtitlesBurned = true;
    }

    const videoPlan = buildRenderVideoPlan(
      clip?.edit?.framingMode || "FIT",
      postFilters,
      this.width,
      this.height,
      {focusX:clip.edit?.focusX},
    );

    const args = [
      "-v",
      "error",
      "-y",
      "-filter_threads", "1",
      "-filter_complex_threads", "1",
      "-threads", String(renderThreads()),
      "-ss",
      startTime.toFixed(3),
      "-i",
      sourcePath,
      "-t",
      duration.toFixed(3),
      ...videoPlan.args,
      "-c:v",
      "libx264",
      "-preset",
      quality.preset,
      "-crf",
      quality.crf,
      "-threads", String(renderThreads()),
      "-r", "30",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "160k",
      "-movflags",
      "+faststart",
      "-progress",
      "pipe:1",
      "-nostats",
      temporaryPath,
    ];

    await runFfmpeg(
      process.env.FFMPEG_PATH?.trim() || "ffmpeg",
      args,
      duration,
      onProgress,
    );

    const validation = await validateMp4(temporaryPath, { requireAudio, duration, width: this.width, height: this.height, allowDarkVideo: project.allowDarkVideo, subtitleValidation: subtitlesBurned ? "ASS_BURNED_NOT_VISUALLY_VERIFIED" : "NOT_REQUESTED" });
    const sourceAfter=await stat(sourcePath);
    if(sourceInfo.size!==sourceAfter.size||sourceInfo.mtimeMs!==sourceAfter.mtimeMs||sourceInfo.ino!==sourceAfter.ino)throw new Error('La fuente cambió durante el render. No se confirmó el resultado.');
    const proof={inputFingerprint,sha256:await sha256(temporaryPath),subtitlesBurned,autoReframeApplied};
    await writeAtomicJson(proofPath,proof);
    await rename(temporaryPath, outputPath);
    return this.renderRecord(project,clip,validation,proof,false);
  }
  async renderRecord(project,clip,validation,proof,reused){
    const outputPath=resolveStoragePath(path.posix.join('clips',project.id,clip.id,'render.mp4'));
    const outputStat=await stat(outputPath);
    return {
      archiveEligible: true,
      validation,
      sha256:proof.sha256,
      inputFingerprint:proof.inputFingerprint,
      recoveredWithoutEncoding:reused,
      relativePath: path.posix.join(
        "clips",
        project.id,
        clip.id,
        "render.mp4",
      ),
      sourceUrl: `/api/projects/${project.id}/clips/${clip.id}/source`,
      width: this.width,
      height: this.height,
      codec: 'h264',
      container: 'mp4',
      sizeBytes: outputStat.size,
      subtitlesBurned:proof.subtitlesBurned,
      autoReframeApplied:proof.autoReframeApplied,
    };
  }
}

export function buildSafeMotionFilter(intensity,width,height) {
  const amplitude = { GENTLE:0, NORMAL:0.015, DYNAMIC:0.03 }[intensity];
  if (amplitude === undefined) throw new Error("Invalid motion intensity.");
  if (amplitude === 0) return "null";
  const factor = `${1-amplitude}+${amplitude}*cos(2*PI*t/18)`;
  return `scale=w='trunc(iw*(${factor})/2)*2':h='trunc(ih*(${factor})/2)*2':eval=frame,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:eval=frame,setsar=1`;
}

export function buildRenderVideoPlan(mode = "FILL", postFilters = [], width = 1080, height = 1920, options = {}) {
  assertResolution(width, height);
  const normalizedPostFilters = Array.isArray(postFilters)
    ? postFilters.filter((value) => typeof value === "string" && value.trim())
    : [];

  if (mode === "CONVERSATION") {
    const graph = [
      "[0:v]split=2[bg][fg]",
      `[bg]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},gblur=sigma=28[bgv]`,
      `[fg]scale=${width}:${height}:force_original_aspect_ratio=decrease[fgv]`,
      "[bgv][fgv]overlay=(W-w)/2:(H-h)/2,setsar=1[basev]",
      `[basev]${normalizedPostFilters.length ? normalizedPostFilters.join(",") : "null"}[vout]`,
    ].join(";");

    return {
      mode: "complex",
      filter: graph,
      args: [
        "-filter_complex",
        graph,
        "-map",
        "[vout]",
        "-map",
        "0:a?",
      ],
    };
  }

  const base = buildVideoFilter(mode, width, height, options);
  const filter = [base, ...normalizedPostFilters].join(",");
  return {
    mode: "simple",
    filter,
    args: [
      "-map",
      "0:v:0",
      "-map",
      "0:a?",
      "-vf",
      filter,
    ],
  };
}

export function buildVideoFilter(mode = "FILL", width = 1080, height = 1920, options = {}) {
  assertResolution(width, height);
  if (mode === "CONVERSATION") {
    throw new Error(
      "CONVERSATION framing requires buildRenderVideoPlan() and FFmpeg -filter_complex.",
    );
  }

  if (mode === "FIT") {
    return [
      `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
      `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:black`,
      "setsar=1",
    ].join(",");
  }

  if (mode !== "FILL") {
    throw new Error("Unsupported framing mode.");
  }

  return [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    options.focusX===undefined ? `crop=${width}:${height}` : buildFocusedCrop(width,height,options.focusX),
    "setsar=1",
  ].join(",");
}

function assertResolution(width, height) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n >= 144 && n <= 3840 && n % 2 === 0)) {
    throw new Error("Invalid output resolution.");
  }
}

function runFfmpeg(command, args, duration, onProgress) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdoutBuffer = "";
    let stderr = "";
    let timedOut = false;
    const requested=Number(process.env.CLIPFORGE_RENDER_TIMEOUT_SECONDS||900);
    const timeoutSeconds=Number.isFinite(requested)?Math.max(30,Math.min(3600,requested)):900;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutSeconds*1000);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk) => {
      stdoutBuffer = (stdoutBuffer + chunk).slice(-2_000_000);
      const lines = stdoutBuffer.split(/\r?\n/);
      stdoutBuffer = lines.pop() || "";

      for (const line of lines) {
        const separator = line.indexOf("=");
        if (separator < 0) continue;

        const key = line.slice(0, separator);
        const value = line.slice(separator + 1);

        if (key === "out_time") {
          const seconds = parseFfmpegTime(value);
          if (Number.isFinite(seconds)) {
            onProgress(
              Math.min(
                99,
                Math.max(0, Math.round((seconds / duration) * 100)),
              ),
            );
          }
        }

        if (key === "progress" && value === "end") {
          onProgress(100);
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-2_000_000);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      if (error?.code === "ENOENT") {
        reject(new Error("FFmpeg is not installed or FFMPEG_PATH is invalid."));
        return;
      }
      reject(error);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && !timedOut) {
        onProgress(100);
        resolve();
        return;
      }

      reject(
        new Error(
          timedOut ? "El render superó su tiempo máximo. Se conservan los recursos y el archivo parcial para diagnóstico." : stderr.trim() || `FFmpeg render failed with code ${code ?? "?"}.`,
        ),
      );
    });
  });
}

function parseFfmpegTime(value) {
  const match = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(String(value).trim());
  if (!match) return Number.NaN;

  return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function escapeFilterPath(filePath) {
  return String(filePath)
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll("'", "\\'")
    .replaceAll(",", "\\,")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]");
}


function buildFocusedCrop(width,height,value){const focus=Number(value);if(!Number.isFinite(focus)||focus<0||focus>1)throw new Error("El punto de encuadre debe estar entre 0 y 1.");return `crop=${width}:${height}:x='max(0,min(iw-ow,iw*${focus.toFixed(6)}-ow/2))':y='(ih-oh)/2'`;}
