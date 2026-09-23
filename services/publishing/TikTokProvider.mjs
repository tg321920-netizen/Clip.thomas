import {
  PublishingProviderError,
  buildCaption,
  readJsonSafe,
  requireAccessToken,
  throwHttpError,
} from "./PublishingProvider.mjs";

const API_BASE = "https://open.tiktokapis.com";

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
      serverHostedMediaRequiresVerifiedUrlProperty: true,
      notes: [
        "Direct Post requires an approved Content Posting API integration and video.publish scope.",
        "Unaudited clients are restricted to private visibility.",
        "TikTok requires current creator info, editable metadata and express user consent before sending content.",
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

    const videoUrl = String(media.publicUrl || "").trim();
    if (!isHttpsUrl(videoUrl)) {
      throw new PublishingProviderError(
        "TikTok PULL_FROM_URL requires an HTTPS media URL whose ownership is verified for the TikTok app.",
        { code: "TIKTOK_VERIFIED_MEDIA_URL_REQUIRED", retryable: false },
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
      source_info: {
        source: "PULL_FROM_URL",
        video_url: videoUrl,
      },
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

    return {
      externalPostId: publishId,
      providerStatus: "PROCESSING",
      raw: body?.data || null,
    };
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

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:";
  } catch {
    return false;
  }
}
