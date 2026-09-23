export class MockPublishingProvider {
  constructor(platform = "TIKTOK", options = {}) {
    this.platform = platform;
    this.externalPostId = options.externalPostId || `mock-${platform.toLowerCase()}-post`;
    this.status = options.status || "PUBLISH_COMPLETE";
  }

  requirements() {
    return { mock: true };
  }

  async publish() {
    return {
      externalPostId: this.externalPostId,
      providerStatus: "PUBLISHED",
      raw: { mock: true },
    };
  }

  async getStatus() {
    return {
      status: this.status,
      raw: { mock: true },
    };
  }

  async refreshAuth() {
    return { mock: true };
  }
}
