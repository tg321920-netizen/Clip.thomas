import { PlatformConnector } from "./PlatformConnector.mjs";

export class YouTubeConnector extends PlatformConnector {
  constructor(options = {}) {
    super("YOUTUBE", options);
  }
}
