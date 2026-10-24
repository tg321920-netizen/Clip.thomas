export class TwitchLiveAdapter {
  constructor({ request }) { this.request = request; }
  async inspect(url) {
    const login = url.pathname.split('/').filter(Boolean)[0];
    if (!login || ['videos', 'directory', 'downloads'].includes(login)) throw new Error('Usa el enlace del canal Twitch para consultar su directo.');
    const clientId = process.env.TWITCH_CLIENT_ID, token = process.env.TWITCH_ACCESS_TOKEN;
    if (!clientId || !token) return { platform: 'TWITCH', state: 'UNCONFIGURED', message: 'Faltan TWITCH_CLIENT_ID y/o TWITCH_ACCESS_TOKEN para consultar Helix.' };
    const result = await this.request(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(login)}`, { 'Client-Id': clientId, Authorization: `Bearer ${token}` });
    if (!Array.isArray(result.data)) throw new Error("La API oficial devolvió metadatos inválidos.");
    const stream = result.data?.[0];
    return { platform: 'TWITCH', state: stream ? 'LIVE' : 'OFFLINE', title: stream?.title || '', channelId: stream?.user_id || null, message: 'Helix consulta el directo. Crear clips nativos es otra operación; aquí no se crea ninguno.' };
  }
}
