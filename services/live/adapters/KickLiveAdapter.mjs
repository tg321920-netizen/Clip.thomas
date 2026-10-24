export class KickLiveAdapter {
  constructor({ request }) { this.request = request; }
  async inspect(url) {
    const slug = url.pathname.split('/').filter(Boolean)[0];
    if (!slug || url.pathname.includes('/videos/')) throw new Error('Usa el enlace del canal Kick para consultar su directo.');
    const token = process.env.KICK_ACCESS_TOKEN;
    if (!token) return { platform: 'KICK', state: 'UNCONFIGURED', message: 'Falta KICK_ACCESS_TOKEN para consultar la API oficial de Kick.' };
    const result = await this.request(`https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`, { Authorization: `Bearer ${token}` });
    if (!Array.isArray(result.data)) throw new Error("La API oficial devolvió metadatos inválidos.");
    const channel = result.data?.[0];
    if (!channel) return { platform: 'KICK', state: 'NOT_FOUND', message: 'La API de Kick no encontró este canal.' };
    return { platform: 'KICK', state: channel.stream?.is_live === true ? 'LIVE' : 'OFFLINE', title: channel.stream_title || '', channelId: String(channel.broadcaster_user_id), message: 'Estado consultado en la API oficial; no concede permiso para capturar el medio.' };
  }
}
