import { PlatformConnector } from "./PlatformConnector.mjs";

export class FacebookConnector extends PlatformConnector {
  constructor(options = {}) {
    super("FACEBOOK", options);
  }
}
