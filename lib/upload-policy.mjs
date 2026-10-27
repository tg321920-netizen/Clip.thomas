export const MAX_UPLOAD_BYTES = 1024 * 1024 * 1024;

const ALLOWED_EXTENSIONS = new Set(["mp4", "mov", "webm", "mp3", "m4a", "wav", "ogg", "flac", "aac"]);
const ALLOWED_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "application/octet-stream",
  "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a", "audio/wav", "audio/x-wav", "audio/wave", "audio/ogg", "application/ogg", "audio/flac", "audio/x-flac", "audio/aac",
]);

export function getExtension(filename) {
  const match = /\.([a-zA-Z0-9]+)$/.exec(filename);
  return match ? match[1].toLowerCase() : "";
}

export function mediaMimeType(filename) {
  return ({mp4:'video/mp4',mov:'video/quicktime',webm:'video/webm',mp3:'audio/mpeg',m4a:'audio/mp4',wav:'audio/wav',ogg:'audio/ogg',flac:'audio/flac',aac:'audio/aac'})[getExtension(filename)] || 'application/octet-stream';
}

export function sanitizeOriginalName(filename) {
  const cleaned = filename
    .normalize("NFKC")
    .replace(/[\\/\0-\x1f\x7f]/g, "_")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.slice(0, 180) || "video";
}

export function validateUploadDescriptor({ filename, mimeType, size }) {
  const extension = getExtension(filename);

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    return { ok: false, error: "Usa MP4, MOV o WebM; para podcasts de audio: MP3, M4A, WAV, OGG, FLAC o AAC." };
  }

  const normalizedMime = (mimeType || "").split(";")[0].trim().toLowerCase();
  if (!ALLOWED_MIME_TYPES.has(normalizedMime)) {
    return { ok: false, error: "El tipo MIME del archivo no está permitido." };
  }

  if (!Number.isFinite(size) || size <= 0) {
    return { ok: false, error: "El archivo está vacío o su tamaño es inválido." };
  }

  if (size > MAX_UPLOAD_BYTES) {
    return {
      ok: false,
      error: "El archivo supera el límite actual de 1 GB para el modo local.",
    };
  }

  return { ok: true, extension };
}
