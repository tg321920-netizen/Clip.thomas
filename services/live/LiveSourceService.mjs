import { KickLiveAdapter } from './adapters/KickLiveAdapter.mjs';
import { TwitchLiveAdapter } from './adapters/TwitchLiveAdapter.mjs';
import { YouTubeLiveAdapter } from './adapters/YouTubeLiveAdapter.mjs';

export function createLiveAdapter(url, options = {}) {
  const dependencies = { request: options.request || officialRequest };
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'kick.com') return new KickLiveAdapter(dependencies);
  if (host === 'twitch.tv' || host === 'm.twitch.tv') return new TwitchLiveAdapter(dependencies);
  if (['youtube.com', 'm.youtube.com', 'youtu.be'].includes(host)) return new YouTubeLiveAdapter(dependencies);
  throw new Error('La consulta oficial admite enlaces de Kick, Twitch y YouTube Live.');
}

export async function inspectLiveSource(rawUrl, options = {}) {
  // Only known platform hosts are accepted. Adapters call fixed official API
  // origins, never the user URL, so local DNS is unnecessary for metadata.
  const url = new URL(rawUrl);
  if (url.username || url.password || url.port) throw new Error('El enlace no debe contener credenciales ni un puerto personalizado.');
  if (url.protocol !== 'https:') throw new Error('Usa HTTPS para consultar una plataforma.');
  try { return await createLiveAdapter(url, options).inspect(url); }
  catch (error) {
    if (error.code === 'PLATFORM_ACCESS_DENIED') return { state: 'ACCESS_DENIED', message: error.message };
    throw error;
  }
}

async function officialRequest(url, headers) {
  // Never expose URL/query strings, headers or provider bodies in errors.
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) {
    const error = new Error(`La API oficial respondió HTTP ${response.status}. Revisa permisos, credenciales y cuota.`);
    if ([401, 403].includes(response.status)) error.code = 'PLATFORM_ACCESS_DENIED';
    throw error;
  }
  return response.json();
}
