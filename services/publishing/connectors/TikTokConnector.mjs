import { PlatformConnector } from "./PlatformConnector.mjs";

export class TikTokConnector extends PlatformConnector {
  constructor(options = {}) {
    super("TIKTOK", options);
  }
}
