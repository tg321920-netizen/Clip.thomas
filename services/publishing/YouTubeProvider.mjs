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

const UPLOAD_BASE = "https://www.googleapis.com/upload/youtube/v3/videos";
const API_BASE = "https://www.googleapis.com/youtube/v3";
const PRIVACY = new Set(["private", "unlisted", "public"]);

export class YouTubeProvider {
  constructor(options = {}) {
    this.platform = "YOUTUBE";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.uploadBase = options.uploadBase || UPLOAD_BASE;
    this.apiBase = options.apiBase || API_BASE;
  }

  requirements() {
    return {
      oauthScopes: ["https://www.googleapis.com/auth/youtube.upload"],
      supportsLocalFileUpload: true,
      notes: [
        "Shorts use the normal YouTube video upload API; YouTube classifies eligible vertical short videos.",
        "Some unverified API projects can be restricted to private uploads until Google completes the required audit.",
      ],
    };
  }

  async publish(context) {
    const accessToken = requireAccessToken(context?.credentials, "YouTube");
    const publication = context?.publication || {};
    const media = context?.media || {};
    const settings = context?.settings || {};
    const filePath = String(media.filePath || "").trim();

    if (!filePath) {
      throw new PublishingProviderError("YouTube requires a local rendered file.", {
        code: "YOUTUBE_MEDIA_REQUIRED",
        retryable: false,
      });
    }

    const file = await stat(filePath);
    if (!file.isFile() || file.size <= 0) {
      throw new PublishingProviderError("YouTube media file is empty or invalid.", {
        code: "YOUTUBE_MEDIA_INVALID",
        retryable: false,
      });
    }

    const privacyStatus = normalizePrivacy(settings.privacyStatus || "private");
    const metadata = {
      snippet: {
        title: cleanText(publication.title || "ClipForge clip", 100),
        description: cleanText(buildCaption(publication, 5000), 5000),
        ...(Array.isArray(settings.tags) && settings.tags.length > 0
          ? { tags: settings.tags.slice(0, 30).map((tag) => cleanText(tag, 100)) }
          : {}),
        ...(typeof settings.categoryId === "string" && settings.categoryId.trim()
          ? { categoryId: settings.categoryId.trim() }
          : {}),
      },
      status: {
        privacyStatus,
        selfDeclaredMadeForKids: Boolean(settings.madeForKids),
      },
    };

    const initUrl = new URL(this.uploadBase);
    initUrl.searchParams.set("uploadType", "resumable");
    initUrl.searchParams.set("part", "snippet,status");

    const initResponse = await this.fetchImpl(initUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(file.size),
      },
      body: JSON.stringify(metadata),
    });

    if (!initResponse.ok) {
      throwHttpError("YouTube", initResponse, await readJsonSafe(initResponse));
    }

    const uploadUrl = initResponse.headers.get("location");
    if (!uploadUrl) {
      throw new PublishingProviderError(
        "YouTube did not return a resumable upload URL.",
        { code: "YOUTUBE_UPLOAD_URL_MISSING", retryable: false },
      );
    }

    const stream = Readable.toWeb(createReadStream(filePath));
    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "video/mp4",
        "Content-Length": String(file.size),
      },
      body: stream,
      duplex: "half",
    });
    const body = await readJsonSafe(uploadResponse);

    if (!uploadResponse.ok) {
      throwHttpError("YouTube", uploadResponse, body);
    }

    const videoId = body?.id;
    if (typeof videoId !== "string" || !videoId) {
      throw new PublishingProviderError("YouTube did not return a video id.", {
        code: "YOUTUBE_INVALID_RESPONSE",
        retryable: false,
      });
    }

    return {
      externalPostId: videoId,
      providerStatus: normalizeYouTubeStatus(body),
      raw: body,
    };
  }

  async getStatus(context) {
    const accessToken = requireAccessToken(context?.credentials, "YouTube");
    const videoId = String(context?.externalPostId || "").trim();
    if (!videoId) {
      throw new PublishingProviderError("YouTube video id is required.", {
        code: "YOUTUBE_VIDEO_ID_REQUIRED",
        retryable: false,
      });
    }

    const url = new URL(`${this.apiBase}/videos`);
    url.searchParams.set("part", "status,processingDetails,statistics");
    url.searchParams.set("id", videoId);

    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await readJsonSafe(response);

    if (!response.ok) throwHttpError("YouTube", response, body);

    const video = Array.isArray(body?.items) ? body.items[0] : null;
    return {
      status: normalizeYouTubeStatus(video),
      privacyStatus: video?.status?.privacyStatus || null,
      statistics: video?.statistics || null,
      raw: video,
    };
  }

  async refreshAuth() {
    throw new PublishingProviderError(
      "YouTube token refresh must be handled by the OAuth credential service.",
      { code: "OAUTH_SERVICE_REQUIRED", retryable: false },
    );
  }
}

export function normalizeYouTubeStatus(video) {
  const processingStatus = String(
    video?.processingDetails?.processingStatus || "",
  ).toLowerCase();
  const uploadStatus = String(video?.status?.uploadStatus || "").toLowerCase();

  if (processingStatus === "succeeded" || uploadStatus === "processed") {
    return "PROCESSED";
  }
  if (["failed", "terminated"].includes(processingStatus)) return "FAILED";
  if (["failed", "rejected", "deleted"].includes(uploadStatus)) {
    return uploadStatus.toUpperCase();
  }
  if (processingStatus) return processingStatus.toUpperCase();
  if (uploadStatus) return uploadStatus.toUpperCase();
  return "UNKNOWN";
}

function normalizePrivacy(value) {
  const privacy = String(value || "").trim().toLowerCase();
  if (!PRIVACY.has(privacy)) {
    throw new PublishingProviderError("Invalid YouTube privacyStatus.", {
      code: "YOUTUBE_PRIVACY_INVALID",
      retryable: false,
    });
  }
  return privacy;
}

function cleanText(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}
