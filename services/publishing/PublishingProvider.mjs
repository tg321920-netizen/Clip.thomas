export class PublishingProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "PublishingProviderError";
    this.code = options.code || "PUBLISHING_PROVIDER_ERROR";
    this.retryable = options.retryable === true;
    this.details = options.details || null;
  }
}

export function requireAccessToken(credentials, platform) {
  const token = credentials?.accessToken;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new PublishingProviderError(
      `${platform} OAuth access token is not configured for this channel.`,
      { code: "OAUTH_NOT_CONFIGURED", retryable: false },
    );
  }
  return token.trim();
}

export function buildCaption(publication, maxLength = 2200) {
  const description = String(publication?.description || "").trim();
  const hashtags = Array.isArray(publication?.hashtags)
    ? publication.hashtags.join(" ").trim()
    : "";
  const value = [description, hashtags].filter(Boolean).join("\n\n");
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

export async function readJsonSafe(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function throwHttpError(platform, response, body, options = {}) {
  const message =
    body?.error?.message ||
    body?.error_description ||
    body?.message ||
    `${platform} API returned HTTP ${response.status}.`;

  const retryable =
    options.retryable ?? (response.status === 429 || response.status >= 500);

  throw new PublishingProviderError(message, {
    code: body?.error?.code || `${platform.toUpperCase()}_HTTP_${response.status}`,
    retryable,
    details: body,
  });
}
