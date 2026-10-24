import { createHash } from 'node:crypto';

// OAuthConnectionService handles user consent for publishing integrations.
// Kick metadata instead needs the official server-to-server client credentials
// grant: no user redirect, stream key, chat permissions or publishing access.
export class KickAppTokenProvider {
  #cached = null;
  #pending = null;
  #now;

  constructor({ now = Date.now } = {}) { this.#now = now; }

  async get({ request, clientId, clientSecret }) {
    const key = createHash('sha256').update(clientId).update('\0').update(clientSecret).digest('hex');
    if (this.#cached?.key === key && this.#cached.expiresAt > this.#now()) return this.#cached.token;
    if (this.#pending?.key === key) return this.#pending.promise;
    const pending = { key, promise: this.#exchange({ request, clientId, clientSecret, key }) };
    this.#pending = pending;
    try { return await pending.promise; }
    finally { if (this.#pending === pending) this.#pending = null; }
  }

  invalidate(token) { if (this.#cached?.token === token) this.#cached = null; }

  async #exchange({ request, clientId, clientSecret, key }) {
    let result;
    try {
      result = await request('https://id.kick.com/oauth/token', { 'Content-Type': 'application/x-www-form-urlencoded' }, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      });
    } catch (cause) {
      // Never propagate OAuth bodies, request headers or client secrets.
      const error = new Error('No se pudo obtener el token de la app Kick. Revisa KICK_CLIENT_ID, KICK_CLIENT_SECRET y el acceso a id.kick.com.');
      if (cause?.code === 'PLATFORM_ACCESS_DENIED') error.code = 'PLATFORM_ACCESS_DENIED';
      throw error;
    }
    const token = result?.access_token;
    const seconds = Number(result?.expires_in);
    if (typeof token !== 'string' || token.length > 16384 || !/^[A-Za-z0-9._~+/-]+=*$/.test(token)
      || String(result?.token_type).toLowerCase() !== 'bearer' || !Number.isFinite(seconds) || seconds <= 0) {
      throw new Error('Kick no devolvió un token de aplicación válido con su caducidad.');
    }
    const ttl = Math.min(seconds * 1000, 86400000);
    this.#cached = { key, token, expiresAt: this.#now() + ttl - Math.min(30000, ttl / 10) };
    return token;
  }
}

const sharedKickAppTokens = new KickAppTokenProvider();

export class KickLiveAdapter {
  #env;
  #tokenProvider;
  constructor({ request, env = process.env, tokenProvider = sharedKickAppTokens }) {
    this.request = request;
    this.#env = env;
    this.#tokenProvider = tokenProvider;
  }
  async inspect(url) {
    const slug = url.pathname.split('/').filter(Boolean)[0];
    if (!slug || url.pathname.includes('/videos/')) throw new Error('Usa el enlace del canal Kick para consultar su directo.');
    const manualToken = this.#env.KICK_ACCESS_TOKEN?.trim();
    const clientId = this.#env.KICK_CLIENT_ID?.trim();
    const clientSecret = this.#env.KICK_CLIENT_SECRET?.trim();
    if (!manualToken && (!clientId || !clientSecret)) return { platform: 'KICK', state: 'UNCONFIGURED', message: 'Configura KICK_CLIENT_ID y KICK_CLIENT_SECRET, o un KICK_ACCESS_TOKEN válido, para consultar la API oficial de Kick.' };
    const credentials = { request: this.request, clientId, clientSecret };
    let token = manualToken || await this.#tokenProvider.get(credentials);
    const endpoint = `https://api.kick.com/public/v1/channels?slug=${encodeURIComponent(slug)}`;
    let result;
    try { result = await this.request(endpoint, { Authorization: `Bearer ${token}` }); }
    catch (error) {
      if (manualToken || error.status !== 401) throw error;
      // A revoked app token may expire before expires_in. Renew once only;
      // permissions failures and manual tokens never trigger silent retries.
      this.#tokenProvider.invalidate(token);
      token = await this.#tokenProvider.get(credentials);
      try { result = await this.request(endpoint, { Authorization: `Bearer ${token}` }); }
      catch (retryError) {
        if (retryError.status === 401) this.#tokenProvider.invalidate(token);
        throw retryError;
      }
    }
    if (!Array.isArray(result.data)) throw new Error("La API oficial devolvió metadatos inválidos.");
    const channel = result.data?.[0];
    if (!channel) return { platform: 'KICK', state: 'NOT_FOUND', message: 'La API de Kick no encontró este canal.' };
    return { platform: 'KICK', state: channel.stream?.is_live === true ? 'LIVE' : 'OFFLINE', title: channel.stream_title || '', channelId: String(channel.broadcaster_user_id), message: 'Estado consultado en la API oficial; no concede permiso para capturar el medio.' };
  }
}
