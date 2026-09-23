import { FacebookProvider } from "./FacebookProvider.mjs";
import { TikTokProvider } from "./TikTokProvider.mjs";
import { YouTubeProvider } from "./YouTubeProvider.mjs";
import { MockPublishingProvider } from "./MockPublishingProvider.mjs";

export function createPublishingProvider(platform, options = {}) {
  const normalized = String(platform || "").trim().toUpperCase();

  if (options.mock === true) {
    return new MockPublishingProvider(normalized, options);
  }

  if (normalized === "TIKTOK") return new TikTokProvider(options);
  if (normalized === "YOUTUBE") return new YouTubeProvider(options);
  if (normalized === "FACEBOOK") return new FacebookProvider(options);

  throw new Error(`Unsupported publishing platform: ${normalized || "empty"}.`);
}
