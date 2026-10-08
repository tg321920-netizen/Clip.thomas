// Production publication is disabled throughout the rescue. Unit tests can
// exercise explicitly injected mock providers without contacting a platform.
export const PUBLISHING_ENABLED = false;
export function assertPublishingAllowed(provider) {
  if (!PUBLISHING_ENABLED && provider?.requirements?.().mock !== true) {
    throw new Error("PUBLISHING = OFF. La publicación está desactivada durante el rescate de ClipForge.");
  }
}
