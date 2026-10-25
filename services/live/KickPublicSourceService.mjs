import { EnvHttpProxyAgent, fetch } from "undici";
import { parsePublicSourceUrl } from "../../lib/public-source-url.mjs";

const dispatcher = new EnvHttpProxyAgent();
export class KickSourceError extends Error {
  constructor(code, stage, message, status) { super(message); this.code = code; this.stage = stage; this.status = status || null; }
}

export function isKickSource(raw) {
  try { return ["kick.com", "www.kick.com"].includes(new URL(raw).hostname.toLowerCase()); } catch { return false; }
}

/** Public viewer metadata/media. This is separate from official OAuth API status. */
export async function resolveKickSource(raw, { signal, request = kickViewerRequest, validateMediaUrl = parsePublicSourceUrl } = {}) {
  const url = new URL(raw), parts = url.pathname.split("/").filter(Boolean);
  const slug = parts[0]?.toLowerCase();
  if (!isKickSource(raw) || url.protocol !== "https:" || url.username || url.password || url.port || !/^[a-z0-9_-]{1,64}$/u.test(slug || "")) {
    throw new KickSourceError("SOURCE_INVALID", "SOURCE_VALIDATION", "Usa un enlace HTTPS válido de Kick.");
  }
  const channel = await request(`https://kick.com/api/v2/channels/${slug}/info`, { signal, stage: "SOURCE_CHANNEL" });
  if (channel?.slug?.toLowerCase() !== slug || !Number.isSafeInteger(channel.id) || channel.id < 1) {
    throw new KickSourceError("SOURCE_METADATA_INVALID", "SOURCE_CHANNEL", "Kick no devolvió la identidad esperada del canal.");
  }
  const common = { platform: "KICK", channel: slug, channelId: String(channel.id), chatroomId: String(channel.chatroom?.id || ""),
    metadataSource: "PUBLIC_VIEWER", rightsReview: "REQUIRED" };
  let mediaUrl, metadata;
  if (parts.length === 1) {
    if (!channel.livestream) throw new KickSourceError("SOURCE_OFFLINE", "SOURCE_STATE", "El canal de Kick no está transmitiendo ahora. Puedes procesar una grabación pública autorizada mediante su enlace específico.");
    mediaUrl = channel.playback_url;
    metadata = { ...common, sourceKind: "LIVE", sourceId: String(channel.livestream.vod_id || channel.livestream.id), streamId: String(channel.livestream.id), title: String(channel.livestream.session_title || ""),
      durationSeconds: null, startedAt: normalizeUtc(channel.livestream.start_time || channel.livestream.created_at) };
  } else if (parts.length === 3 && parts[1] === "videos" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/iu.test(parts[2])) {
    const videoId = parts[2];
    const videos = await request(`https://web.kick.com/api/v1/channels/${channel.id}/videos`, { signal, stage: "SOURCE_AVAILABILITY" });
    const video = Array.isArray(videos?.data) ? videos.data.find(v => v.id === videoId) : null;
    if (!video) throw new KickSourceError("SOURCE_NOT_FOUND", "SOURCE_AVAILABILITY", "No se encontró esa grabación entre los videos públicos recientes del canal.");
    if (video.status !== "public") throw new KickSourceError("SOURCE_ACCESS_DENIED", "SOURCE_AVAILABILITY", "La grabación no está disponible como video público. ClipForge no elude accesos privados o de suscripción.");
    const playback = await request(`https://web.kick.com/api/v1/stream/${videoId}/playback`, { signal, stage: "SOURCE_PLAYBACK", method: "POST",
      body: { video_player: { player: {} }, video_session: {}, user_session: { non_personalised_ads: true } } });
    if (String(playback.video_session?.creator_id) !== String(channel.id) || (playback.video_session?.video_id && playback.video_session.video_id !== videoId)) {
      throw new KickSourceError("SOURCE_METADATA_INVALID", "SOURCE_PLAYBACK", "El medio no corresponde al canal y la grabación solicitados.");
    }
    if (/drm|widevine|playready|fairplay|aes/iu.test(String(playback.video_session?.video_encryption_type || ""))) {
      throw new KickSourceError("SOURCE_ENCRYPTED", "SOURCE_PLAYBACK", "El medio indica protección de contenido; no se intenta descifrarlo.");
    }
    mediaUrl = playback.playback_url?.vod;
    metadata = { ...common, sourceKind: "VOD", sourceId: videoId, title: String(video.title || ""), durationSeconds: Number(video.duration) || null,
      startedAt: normalizeUtc(video.start_time) };
  } else {
    throw new KickSourceError("SOURCE_UNSUPPORTED", "SOURCE_VALIDATION", "La captura de Kick admite el canal en directo o el enlace específico de una grabación pública.");
  }
  if (typeof mediaUrl !== "string" || mediaUrl.length > 65536) throw new KickSourceError("SOURCE_MEDIA_MISSING", "SOURCE_PLAYBACK", "Kick no entregó una fuente multimedia reproducible.");
  let source;
  try { source = await validateMediaUrl(mediaUrl); } catch { throw new KickSourceError("SOURCE_MEDIA_INVALID", "SOURCE_PLAYBACK", "La dirección multimedia entregada por Kick no es una fuente pública válida."); }
  if (source.protocol !== "https:" || source.username || source.password) throw new KickSourceError("SOURCE_MEDIA_INVALID", "SOURCE_PLAYBACK", "La dirección multimedia entregada por Kick no es válida.");
  return { url: source.toString(), inputFormat: "HLS", metadata };
}

function normalizeUtc(value) {
  const time = Date.parse(String(value || "")); return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export async function kickViewerRequest(url, { signal, stage, method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(url, { dispatcher, method, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  } catch { signal?.throwIfAborted(); throw new KickSourceError("SOURCE_TRANSPORT_ERROR", stage, "No se pudo consultar la fuente pública de Kick. No se registran datos privados."); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new KickSourceError([401, 403].includes(response.status) ? "SOURCE_ACCESS_DENIED" : "SOURCE_HTTP_ERROR", stage,
      `La consulta pública de Kick respondió HTTP ${response.status} en ${stage}.`, response.status);
  }
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error("oversized"); chunks.push(Buffer.from(value)); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch { await reader.cancel().catch(() => {}); throw new KickSourceError("SOURCE_METADATA_INVALID", stage, "Kick devolvió una respuesta de metadatos inválida o demasiado grande."); }
}
