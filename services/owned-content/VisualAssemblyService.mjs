import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveStoragePath } from "../../lib/storage-paths.mjs";
import { RightsGuard } from "./RightsGuard.mjs";
import { ContentCostService } from "./ContentCostService.mjs";

export class VisualAssemblyService {
  constructor(options = {}) {
    this.rights = options.rights || new RightsGuard();
    this.costs = options.costs || new ContentCostService();
  }

  async prepare(input = {}) {
    const projectId = String(input.projectId || "").trim();
    const channelId = String(input.channelId || "").trim();
    const research = input.research;
    if (!projectId || !channelId || !research?.topicFingerprint) throw new Error("Visual assembly needs project, channel and research context.");

    const selected = [];
    for (const assetId of [...new Set((input.assetIds || []).map(String))]) {
      const asset = await this.rights.assertUsable(assetId);
      if (asset.channelId !== channelId) {
        throw new Error("Visual asset belongs to another channel and cannot cross Content Factory channel boundaries.");
      }
      selected.push(asset);
    }

    const posterRelativePath = path.posix.join("uploads", projectId, "poster.jpg");
    const posterPath = resolveStoragePath(posterRelativePath);
    await mkdir(path.dirname(posterPath), { recursive: true });
    let generatedOwnedGraphic = false;
    let primaryAsset = selected.find((asset) => asset.localRelativePath && ["IMAGE", "VIDEO", "GRAPHIC"].includes(asset.mediaType)) || null;

    if (primaryAsset) {
      await renderPosterFromAsset(resolveStoragePath(primaryAsset.localRelativePath), posterPath, primaryAsset.mediaType);
    } else {
      await renderOwnedGraphic(posterPath, input.brand?.colors?.primary);
      generatedOwnedGraphic = true;
      primaryAsset = await this.rights.register({
        channelId,
        contentId: input.contentId || projectId,
        mediaType: "GRAPHIC",
        rightsClass: "OWNED",
        localRelativePath: posterRelativePath,
        topicFingerprint: research.topicFingerprint,
        labels: ["generated-graphic", "story-background"],
        provenance: {
          owner: "ClipForge user",
          permissionNote: "Generated locally by ClipForge from a color field; no third-party visual was copied.",
          obtainedAt: new Date().toISOString(),
        },
      });
      selected.push(primaryAsset);
    }

    const verification = await this.rights.verifyAssets(selected.map((asset) => asset.id));
    await this.costs.record({ channelId, contentId: input.contentId || null, category: "VISUAL", provider: "local-ffmpeg", operation: "visual-assembly", amountUsd: 0, note: generatedOwnedGraphic ? "Generated owned background locally." : "Prepared rights-cleared local media." });

    return {
      posterRelativePath,
      primaryAssetId: primaryAsset.id,
      assetIds: selected.map((asset) => asset.id),
      assets: selected,
      topicFingerprint: research.topicFingerprint,
      generatedOwnedGraphic,
      rightsReady: verification.ready,
      blockedAssets: verification.blocked,
      method: generatedOwnedGraphic ? "OWNED_GRAPHIC" : "RIGHTS_CLEARED_MEDIA",
    };
  }
}

async function renderOwnedGraphic(outputPath, requestedColor) {
  const color = normalizeColor(requestedColor) || "0x11131A";
  await runFfmpeg(["-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=1080x1920:r=1`, "-frames:v", "1", "-q:v", "2", outputPath]);
}
async function renderPosterFromAsset(inputPath, outputPath, mediaType) {
  const args = ["-v", "error", "-y", "-i", inputPath];
  if (mediaType === "VIDEO") args.push("-ss", "0");
  args.push("-vf", "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920", "-frames:v", "1", "-q:v", "2", outputPath);
  await runFfmpeg(args);
}
function runFfmpeg(args) {
  const command = process.env.FFMPEG_PATH?.trim() || "ffmpeg";
  return new Promise((resolve, reject) => {
    const child = spawn(/*turbopackIgnore: true*/ command, args, { shell: false, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = ""; child.stderr.setEncoding("utf8"); child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => reject(error?.code === "ENOENT" ? new Error("FFmpeg is not installed or FFMPEG_PATH is invalid.") : error));
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `FFmpeg visual preparation failed with code ${code ?? "?"}.`)));
  });
}
function normalizeColor(value) { const text = String(value || "").trim(); if (/^#[0-9a-f]{6}$/i.test(text)) return `0x${text.slice(1)}`; if (/^0x[0-9a-f]{6}$/i.test(text)) return text; return null; }
