import { spawn } from "node:child_process";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot, resolveStoragePath } from "../../lib/storage-paths.mjs";
import { EspeakNewsTtsProvider } from "../news/EspeakNewsTtsProvider.mjs";
import { ContentCostService } from "./ContentCostService.mjs";
import { RightsGuard } from "./RightsGuard.mjs";

const PROFILES = Object.freeze({
  US_NEWS_EN: { language: "en-US", voice: "en-us", speed: 168, tone: "natural-us-news" },
  LATAM_NEWS_ES: { language: "es-419", voice: "es", speed: 165, tone: "neutral-latam" },
  ENTERTAINMENT_ES: { language: "es-419", voice: "es", speed: 182, tone: "energetic-clear" },
});

export class AudioEngine {
  constructor(options = {}) {
    this.rights = options.rights || new RightsGuard();
    this.costs = options.costs || new ContentCostService();
    this.freeProviderFactory = options.freeProviderFactory || ((profile) => new EspeakNewsTtsProvider({ voice: profile.voice, speed: profile.speed }));
    this.premiumProvider = options.premiumProvider || null;
  }

  async render(input = {}) {
    const script = input.script;
    if (!script?.narration) throw new Error("Narration script is required.");
    const profile = getVoiceProfile(input.voiceProfile);
    const mode = String(input.mode || "TTS_FREE").trim().toUpperCase();
    const contentId = String(input.contentId || script.id || "").trim();
    if (!contentId) throw new Error("Audio contentId is required.");

    const budget = input.budget || {};
    if (mode === "TTS_PREMIUM") {
      if (input.authorizedPremium !== true) throw new Error("TTS_PREMIUM requires explicit authorization. No paid TTS was consumed.");
      if (!this.premiumProvider?.synthesize) throw new Error("TTS_PREMIUM provider is not configured.");
      await this.costs.assertBudget(input.channelId, budget, Number(input.estimatedPremiumCostUsd || 0));
    }

    const outputDir = path.join(getStorageRoot(), "owned-content", "audio", contentId);
    const rawPath = path.join(outputDir, "raw-narration.wav");
    const outputPath = path.join(outputDir, "narration.wav");
    await mkdir(outputDir, { recursive: true });

    const provider = mode === "TTS_PREMIUM" ? this.premiumProvider : this.freeProviderFactory(profile);
    await provider.synthesize({ text: script.narration, outputPath: rawPath, voiceProfile: profile });

    let musicPath = null;
    let musicAsset = null;
    if (input.musicAssetId) {
      musicAsset = await this.rights.assertUsable(input.musicAssetId);
      if (musicAsset.mediaType !== "MUSIC" && musicAsset.mediaType !== "AUDIO") throw new Error("Selected background asset is not audio/music.");
      if (!musicAsset.localRelativePath) throw new Error("Permitted music asset does not have a local file.");
      musicPath = resolveStoragePath(musicAsset.localRelativePath);
    }

    await mixAndNormalize(rawPath, outputPath, musicPath);
    await rm(rawPath, { force: true });
    const durationSeconds = await probeDuration(outputPath);
    const subtitleCues = buildSubtitleCues(script.narration, durationSeconds);

    if (mode === "TTS_FREE") {
      await this.costs.record({ channelId: input.channelId, contentId: input.contentId || null, category: "TTS", provider: provider.name || "espeak-ng", operation: "narration", amountUsd: 0, note: "Local/free TTS." });
    } else {
      const actual = input.actualPremiumCostUsd;
      await this.costs.record({ channelId: input.channelId, contentId: input.contentId || null, category: "TTS", provider: provider.name || "premium", operation: "narration", amountUsd: actual === undefined ? null : actual, note: "Premium TTS used only after explicit authorization." });
    }

    return {
      mode,
      provider: provider.name || (mode === "TTS_FREE" ? "local-free" : "premium"),
      voiceProfile: input.voiceProfile,
      profile,
      relativePath: path.posix.join("owned-content", "audio", contentId, "narration.wav"),
      durationSeconds,
      subtitleCues,
      musicAssetId: musicAsset?.id || null,
      mix: { normalized: true, targetLufs: -16, musicDucking: Boolean(musicPath), transitions: Boolean(musicPath) },
    };
  }
}

export function getVoiceProfile(key) {
  const normalized = String(key || "LATAM_NEWS_ES").trim().toUpperCase();
  const profile = PROFILES[normalized];
  if (!profile) throw new Error("Unsupported voice profile.");
  return { key: normalized, ...profile, clonePolicy: "NO_REAL_PERSON_IMPERSONATION" };
}

async function mixAndNormalize(narrationPath, outputPath, musicPath) {
  const ffmpeg = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  const args = ["-v", "error", "-y", "-i", narrationPath];
  if (musicPath) {
    args.push("-stream_loop", "-1", "-i", musicPath, "-filter_complex",
      "[1:a]volume=0.14[music];[music][0:a]sidechaincompress=threshold=0.03:ratio=12:attack=20:release=500[ducked];[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=2,loudnorm=I=-16:TP=-1.5:LRA=11[a]",
      "-map", "[a]");
  } else {
    args.push("-filter:a", "loudnorm=I=-16:TP=-1.5:LRA=11");
  }
  args.push("-c:a", "pcm_s16le", outputPath);
  await run(ffmpeg, args, "FFmpeg audio mixing failed.");
}

function buildSubtitleCues(text, duration) {
  const sentences = String(text || "").split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  if (sentences.length === 0 || !(duration > 0)) return [];
  const totalWords = sentences.reduce((sum, sentence) => sum + wordCount(sentence), 0) || 1;
  let cursor = 0;
  return sentences.map((sentence, index) => {
    const share = wordCount(sentence) / totalWords;
    const startTime = cursor;
    const endTime = index === sentences.length - 1 ? duration : Math.min(duration, cursor + duration * share);
    cursor = endTime;
    return { id: `narration-${index + 1}`, startTime: round(startTime), endTime: round(endTime), text: sentence };
  });
}

async function probeDuration(filePath) {
  const output = await run(process.env.FFPROBE_PATH?.trim() || "ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", filePath], "FFprobe failed.", true);
  const duration = Number(String(output).trim());
  if (!Number.isFinite(duration) || duration <= 0) throw new Error("Narration has invalid duration.");
  return duration;
}
function run(command, args, fallback, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; }); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(error?.code === "ENOENT" ? new Error(`${command} is not installed or its configured path is invalid.`) : error));
    child.on("close", (code) => code === 0 ? resolve(capture ? stdout : undefined) : reject(new Error(stderr.trim() || fallback)));
  });
}
function wordCount(value) { return String(value || "").trim().split(/\s+/).filter(Boolean).length; }
function round(value) { return Math.round(Number(value) * 1000) / 1000; }
