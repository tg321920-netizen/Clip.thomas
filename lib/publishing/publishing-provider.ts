export type PublishingPlatform = "TIKTOK" | "YOUTUBE" | "FACEBOOK";

export type PublishRequest = {
  publicationId: string;
  channelId: string;
  platform: PublishingPlatform;
  videoPath: string;
  title: string;
  description?: string;
};

export type PublishResult = {
  providerPostId: string;
  publishedAt: string;
  url?: string;
};

/**
 * Boundary for official platform publishing integrations.
 *
 * Implementations must obtain credentials from a server-side secure store.
 * Tokens, refresh tokens and client secrets must never be persisted in the
 * file-based ChannelRecord or exposed to the browser.
 */
export interface PublishingProvider {
  readonly platform: PublishingPlatform;
  publish(request: PublishRequest): Promise<PublishResult>;
}

export class PublishingNotConfiguredError extends Error {
  constructor(platform: PublishingPlatform) {
    super(`${platform} publishing is not configured with an authorized official provider`);
    this.name = "PublishingNotConfiguredError";
  }
}

/**
 * Safe default used until OAuth and the corresponding official provider are
 * configured. It deliberately fails closed rather than pretending a post was
 * published.
 */
export class UnconfiguredPublishingProvider implements PublishingProvider {
  constructor(readonly platform: PublishingPlatform) {}

  async publish(_request: PublishRequest): Promise<PublishResult> {
    throw new PublishingNotConfiguredError(this.platform);
  }
}

export class PublishingProviderRegistry {
  private readonly providers = new Map<PublishingPlatform, PublishingProvider>();

  register(provider: PublishingProvider): void {
    this.providers.set(provider.platform, provider);
  }

  get(platform: PublishingPlatform): PublishingProvider {
    return this.providers.get(platform) ?? new UnconfiguredPublishingProvider(platform);
  }
}
