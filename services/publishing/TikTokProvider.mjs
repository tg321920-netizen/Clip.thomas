import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  PublishingProviderError,
  buildCaption,
  readJsonSafe,
  requireAccessToken,
  throwHttpError,
} from "./PublishingProvider.mjs";

const API_BASE = "https://open.tiktokapis.com";
const MIN_CHUNK_BYTES = 5_000_000;
const MAX_CHUNK_BYTES = 64_000_000;
const DEFAULT_CHUNK_BYTES = 10_000_000;
const MAX_VIDEO_BYTES = 4_000_000_000;

export class TikTokProvider {
  constructor(options = {}) {
    this.platform = "TIKTOK";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.apiBase = options.apiBase || API_BASE;
  }

  requirements() {
    return {
      oauthScopes: ["video.publish"],
      requiresPerPostConsent: true,
      requiresCreatorInfoBeforePost: true,
      supportsLocalFileUpload: true,
      supportsVerifiedUrlPull: true,
      notes: [
        "Direct Post requires an approved Content Posting API integration and video.publish scope.",
        "Unaudited clients are restricted to private visibility.",
        "TikTok requires current creator info, editable metadata and express user consent before sending content.",
        "ClipForge prefers FILE_UPLOAD for rendered local clips; PULL_FROM_URL remains available only for a verified HTTPS domain.",
      ],
    };
  }

  async publish(context) {
    const accessToken = requireAccessToken(context?.credentials, "TikTok");
    const publication = context?.publication || {};
    const settings = context?.settings || {};
    const media = context?.media || {};

    if (!publication.consentAt) {
      throw new PublishingProviderError(
        "TikTok requires express user consent for this publication before upload.",
        { code: "TIKTOK_CONSENT_REQUIRED", retryable: false },
      );
    }

    const privacyLevel = String(settings.privacyLevel || "").trim();
    if (!privacyLevel) {
      throw new PublishingProviderError(
        "TikTok privacyLevel must be selected by the user before publishing.",
        { code: "TIKTOK_PRIVACY_REQUIRED", retryable: false },
      );
    }

    const creator = await this.getCreatorInfo(accessToken);
    const allowedPrivacy = Array.isArray(creator?.privacy_level_options)
      ? creator.privacy_level_options
      : [];

    if (!allowedPrivacy.includes(privacyLevel)) {
      throw new PublishingProviderError(
        "Selected TikTok privacy level is not available for this creator.",
        { code: "TIKTOK_PRIVACY_MISMATCH", retryable: false },
      );
    }

    const duration = Number(media.durationSeconds);
    const maxDuration = Number(creator?.max_video_post_duration_sec);
    if (
      Number.isFinite(duration) &&
      Number.isFinite(maxDuration) &&
      duration > maxDuration
    ) {
      throw new PublishingProviderError(
        `Clip duration exceeds this TikTok creator's ${maxDuration}s posting limit.`,
        { code: "TIKTOK_DURATION_LIMIT", retryable: false },
      );
    }

    const transfer = await this.#prepareTransfer(media, settings);
    const payload = {
      post_info: {
        title: buildCaption(publication, 2200),
        privacy_level: privacyLevel,
        disable_duet: Boolean(settings.disableDuet),
        disable_comment: Boolean(settings.disableComment),
        disable_stitch: Boolean(settings.disableStitch),
        brand_content_toggle: Boolean(settings.brandContent),
        brand_organic_toggle: Boolean(settings.brandOrganic),
        ...(typeof settings.isAigc === "boolean"
          ? { is_aigc: settings.isAigc }
          : {}),
      },
      source_info: transfer.sourceInfo,
    };

    const response = await this.fetchImpl(
      `${this.apiBase}/v2/post/publish/video/init/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify(payload),
      },
    );
    const body = await readJsonSafe(response);

    if (!response.ok || body?.error?.code !== "ok") {
      throwHttpError("TikTok", response, body, {
        retryable:
          response.status === 429 ||
          response.status >= 500 ||
          body?.error?.code === "internal_error",
      });
    }

    const publishId = body?.data?.publish_id;
    if (typeof publishId !== "string" || !publishId) {
      throw new PublishingProviderError("TikTok did not return a publish_id.", {
        code: "TIKTOK_INVALID_RESPONSE",
        retryable: false,
      });
    }

    if (transfer.mode === "FILE_UPLOAD") {
      const uploadUrl = String(body?.data?.upload_url || "").trim();
      if (!isHttpsUrl(uploadUrl)) {
        throw new PublishingProviderError(
          "TikTok did not return a valid upload_url for FILE_UPLOAD.",
          { code: "TIKTOK_UPLOAD_URL_MISSING", retryable: false },
        );
      }
      await this.#uploadFile(uploadUrl, transfer);
    }

    return {
      externalPostId: publishId,
      providerStatus: "PROCESSING",
      raw: body?.data || null,
    };
  }

  async #prepareTransfer(media, settings) {
    const requested = String(settings?.transferMethod || "").trim().toUpperCase();
    const filePath = String(media?.filePath || "").trim();
    const videoUrl = String(media?.publicUrl || "").trim();

    if (requested === "PULL_FROM_URL" || (!filePath && videoUrl)) {
      if (!isHttpsUrl(videoUrl)) {
        throw new PublishingProviderError(
          "TikTok PULL_FROM_URL requires an HTTPS media URL whose ownership is verified for the TikTok app.",
          { code: "TIKTOK_VERIFIED_MEDIA_URL_REQUIRED", retryable: false },
        );
      }
      return {
        mode: "PULL_FROM_URL",
        sourceInfo: { source: "PULL_FROM_URL", video_url: videoUrl },
      };
    }

    if (!filePath) {
      throw new PublishingProviderError(
        "TikTok requires a rendered local file or a verified HTTPS media URL.",
        { code: "TIKTOK_MEDIA_REQUIRED", retryable: false },
      );
    }

    let file;
    try {
      file = await stat(filePath);
    } catch {
      throw new PublishingProviderError("TikTok media file could not be read.", {
        code: "TIKTOK_MEDIA_INVALID",
        retryable: false,
      });
    }

    if (!file.isFile() || file.size <= 0 || file.size > MAX_VIDEO_BYTES) {
      throw new PublishingProviderError(
        "TikTok media file is empty, invalid, or exceeds the 4 GB API limit.",
        { code: "TIKTOK_MEDIA_INVALID", retryable: false },
      );
    }

    const plan = createTikTokChunkPlan(file.size);
    return {
      mode: "FILE_UPLOAD",
      filePath,
      fileSize: file.size,
      mimeType: "video/mp4",
      plan,
      sourceInfo: {
        source: "FILE_UPLOAD",
        video_size: file.size,
        chunk_size: plan.chunkSize,
        total_chunk_count: plan.totalChunkCount,
      },
    };
  }

  async #uploadFile(uploadUrl, transfer) {
    const { filePath, fileSize, mimeType, plan } = transfer;

    for (let index = 0; index < plan.totalChunkCount; index += 1) {
      const start = index * plan.chunkSize;
      const end =
        index === plan.totalChunkCount - 1
          ? fileSize - 1
          : Math.min(fileSize - 1, start + plan.chunkSize - 1);
      const length = end - start + 1;
      const stream = Readable.toWeb(createReadStream(filePath, { start, end }));

      const response = await this.fetchImpl(uploadUrl, {
        method: "PUT",
        headers: {
          "Content-Type": mimeType,
          "Content-Length": String(length),
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        },
        body: stream,
        duplex: "half",
      });

      if (!response.ok) {
        let body = null;
        try {
          body = await readJsonSafe(response);
        } catch {
          body = null;
        }
        throwHttpError("TikTok media upload", response, body, {
          retryable: response.status >= 500 || response.status === 429,
        });
      }
    }
  }

  async getStatus(context) {
    const accessToken = requireAccessToken(context?.credentials, "TikTok");
    const publishId = String(context?.externalPostId || "").trim();
    if (!publishId) {
      throw new PublishingProviderError("TikTok publish_id is required.", {
        code: "TIKTOK_PUBLISH_ID_REQUIRED",
        retryable: false,
      });
    }

    const response = await this.fetchImpl(
      `${this.apiBase}/v2/post/publish/status/fetch/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: JSON.stringify({ publish_id: publishId }),
      },
    );
    const body = await readJsonSafe(response);

    if (!response.ok || body?.error?.code !== "ok") {
      throwHttpError("TikTok", response, body);
    }

    return {
      status: body?.data?.status || "UNKNOWN",
      postIds: body?.data?.publicaly_available_post_id || [],
      failReason: body?.data?.fail_reason || null,
      raw: body?.data || null,
    };
  }

  async refreshAuth() {
    throw new PublishingProviderError(
      "TikTok token refresh must be handled by the OAuth credential service.",
      { code: "OAUTH_SERVICE_REQUIRED", retryable: false },
    );
  }

  async getCreatorInfo(accessToken) {
    const response = await this.fetchImpl(
      `${this.apiBase}/v2/post/publish/creator_info/query/`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
        },
        body: "{}",
      },
    );
    const body = await readJsonSafe(response);

    if (!response.ok || body?.error?.code !== "ok") {
      throwHttpError("TikTok", response, body);
    }

    return body?.data || {};
  }
}

export function createTikTokChunkPlan(fileSize) {
  const size = Number(fileSize);
  if (!Number.isInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    throw new PublishingProviderError("TikTok file size is outside the supported range.", {
      code: "TIKTOK_MEDIA_INVALID",
      retryable: false,
    });
  }

  if (size <= MAX_CHUNK_BYTES) {
    return { chunkSize: size, totalChunkCount: 1 };
  }

  const chunkSize = DEFAULT_CHUNK_BYTES;
  const totalChunkCount = Math.floor(size / chunkSize);
  if (
    chunkSize < MIN_CHUNK_BYTES ||
    chunkSize > MAX_CHUNK_BYTES ||
    totalChunkCount < 1 ||
    totalChunkCount > 1000
  ) {
    throw new PublishingProviderError("TikTok chunk plan is invalid.", {
      code: "TIKTOK_CHUNK_PLAN_INVALID",
      retryable: false,
    });
  }

  return { chunkSize, totalChunkCount };
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
