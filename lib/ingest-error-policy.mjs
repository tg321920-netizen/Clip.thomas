/** Temporary transport/server errors may retry; permanent remote-source errors must stop. */
export function isRetryableIngestError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  if (/\b(?:HTTP(?: Error)?|server returned)\s*[: ]*\s*(?:400|401|403|404|410|451)\b/i.test(message)) return false;
  if (/\b(?:unsupported URL|video unavailable|private video|this video is private|not available in your country|content is not available|sign in to confirm|not a bot|login required|access denied|not found|does not exist|the channel is not currently live|the user is not currently live|channel is offline|livestream is offline|not currently live)\b/i.test(message)) return false;
  if (/\b(?:yt-dlp no está disponible|FFmpeg no está disponible|FFprobe no está disponible|no contiene una pista de video válida)\b/i.test(message)) return false;
  return true;
}
