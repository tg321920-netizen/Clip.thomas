export class YouTubeLiveAdapter {
  constructor({ request }) { this.request = request; }
  async inspect(url) {
    const videoId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || /^\/(?:live|shorts)\/([^/]+)/.exec(url.pathname)?.[1];
    if (!videoId || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new Error('Usa el enlace del video YouTube Live, no la portada del canal.');
    const key = process.env.YOUTUBE_API_KEY;
    if (!key) return { platform: 'YOUTUBE', state: 'UNCONFIGURED', message: 'Falta YOUTUBE_API_KEY para consultar YouTube Data API.' };
    const result = await this.request(`https://www.googleapis.com/youtube/v3/videos?part=snippet,liveStreamingDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(key)}`, {});
    if (!Array.isArray(result.items)) throw new Error("La API oficial devolvió metadatos inválidos.");
    const video = result.items?.[0];
    if (!video) return { platform: 'YOUTUBE', state: 'NOT_FOUND', message: 'Video inexistente, privado o no accesible con esta autorización.' };
    const details = video.liveStreamingDetails;
    const state = details?.actualEndTime ? 'ENDED' : details?.actualStartTime ? 'LIVE' : details?.scheduledStartTime ? 'SCHEDULED' : 'VOD';
    return { platform: 'YOUTUBE', state, title: video.snippet?.title || '', channelId: video.snippet?.channelId || null, message: 'Data API solo aporta metadatos; no entrega un MP4 descargable ni autoriza su captura.' };
  }
}
