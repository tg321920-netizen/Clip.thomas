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

const GRAPH_BASE = "https://graph.facebook.com";

export class FacebookProvider {
  constructor(options = {}) {
    this.platform = "FACEBOOK";
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.graphBase = options.graphBase || GRAPH_BASE;
    this.apiVersion =
      options.apiVersion || process.env.META_GRAPH_API_VERSION?.trim() || "";
  }

  requirements() {
    return {
      oauthPermissions: [
        "pages_show_list",
        "pages_read_engagement",
        "pages_manage_posts",
      ],
      requiresPageAccessToken: true,
      requiresGraphApiVersion: true,
      notes: [
        "Facebook Reels publishing acts on a Page and requires a Page access token with approved permissions.",
        "META_GRAPH_API_VERSION must be configured explicitly so ClipForge does not silently pin an obsolete Graph version.",
      ],
    };
  }

  async publish(context) {
    const accessToken = requireAccessToken(context?.credentials, "Facebook");
    const pageId = String(context?.credentials?.pageId || "").trim();
    const publication = context?.publication || {};
    const media = context?.media || {};
    const filePath = String(media.filePath || "").trim();
    const version = this.#requireVersion();

    if (!pageId) {
      throw new PublishingProviderError("Facebook Page id is required.", {
        code: "FACEBOOK_PAGE_ID_REQUIRED",
        retryable: false,
      });
    }
    if (!filePath) {
      throw new PublishingProviderError("Facebook requires a rendered Reel file.", {
        code: "FACEBOOK_MEDIA_REQUIRED",
        retryable: false,
      });
    }

    const file = await stat(filePath);
    if (!file.isFile() || file.size <= 0) {
      throw new PublishingProviderError("Facebook Reel file is empty or invalid.", {
        code: "FACEBOOK_MEDIA_INVALID",
        retryable: false,
      });
    }

    const startUrl = new URL(
      `${this.graphBase}/${version}/${encodeURIComponent(pageId)}/video_reels`,
    );
    startUrl.searchParams.set("upload_phase", "start");

    const startResponse = await this.fetchImpl(startUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const startBody = await readJsonSafe(startResponse);

    if (!startResponse.ok) {
      throwHttpError("Facebook", startResponse, startBody);
    }

    const videoId = String(startBody?.video_id || "").trim();
    const uploadUrl = String(startBody?.upload_url || "").trim();
    if (!videoId || !isHttpsUrl(uploadUrl)) {
      throw new PublishingProviderError(
        "Facebook did not return a valid Reel upload session.",
        { code: "FACEBOOK_UPLOAD_SESSION_INVALID", retryable: false },
      );
    }

    const stream = Readable.toWeb(createReadStream(filePath));
    const uploadResponse = await this.fetchImpl(uploadUrl, {
      method: "POST",
      headers: {
        Authorization: `OAuth ${accessToken}`,
        offset: "0",
        file_size: String(file.size),
        "Content-Type": "application/octet-stream",
      },
      body: stream,
      duplex: "half",
    });
    const uploadBody = await readJsonSafe(uploadResponse);

    if (!uploadResponse.ok || uploadBody?.success === false) {
      throwHttpError("Facebook", uploadResponse, uploadBody);
    }

    const finishUrl = new URL(
      `${this.graphBase}/${version}/${encodeURIComponent(pageId)}/video_reels`,
    );
    finishUrl.searchParams.set("video_id", videoId);
    finishUrl.searchParams.set("upload_phase", "finish");
    finishUrl.searchParams.set("video_state", "PUBLISHED");

    const title = String(publication.title || "").trim();
    const description = buildCaption(publication, 2200);
    if (title) finishUrl.searchParams.set("title", title.slice(0, 255));
    if (description) finishUrl.searchParams.set("description", description);

    const finishResponse = await this.fetchImpl(finishUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const finishBody = await readJsonSafe(finishResponse);

    if (!finishResponse.ok || finishBody?.success === false) {
      throwHttpError("Facebook", finishResponse, finishBody);
    }

    return {
      externalPostId: videoId,
      providerStatus: "PROCESSING",
      raw: finishBody,
    };
  }

  async getStatus(context) {
    const accessToken = requireAccessToken(context?.credentials, "Facebook");
    const videoId = String(context?.externalPostId || "").trim();
    const version = this.#requireVersion();

    if (!videoId) {
      throw new PublishingProviderError("Facebook video id is required.", {
        code: "FACEBOOK_VIDEO_ID_REQUIRED",
        retryable: false,
      });
    }

    const url = new URL(
      `${this.graphBase}/${version}/${encodeURIComponent(videoId)}`,
    );
    url.searchParams.set("fields", "status");

    const response = await this.fetchImpl(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = await readJsonSafe(response);

    if (!response.ok) throwHttpError("Facebook", response, body);

    return {
      status: body?.status?.video_status || "UNKNOWN",
      raw: body?.status || body,
    };
  }

  async refreshAuth() {
    throw new PublishingProviderError(
      "Facebook token refresh must be handled by the OAuth credential service.",
      { code: "OAUTH_SERVICE_REQUIRED", retryable: false },
    );
  }

  #requireVersion() {
    if (!/^v\d+\.\d+$/.test(this.apiVersion)) {
      throw new PublishingProviderError(
        "META_GRAPH_API_VERSION must be configured with the Graph API version approved for the Meta app.",
        { code: "META_GRAPH_VERSION_REQUIRED", retryable: false },
      );
    }
    return this.apiVersion;
  }
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}
