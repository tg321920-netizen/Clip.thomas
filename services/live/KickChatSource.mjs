import { randomUUID } from "node:crypto";
import { EnvHttpProxyAgent, WebSocket } from "undici";
import { ChatActivityCollector } from "../analysis/ChatActivityService.mjs";
import { kickViewerRequest } from "./KickPublicSourceService.mjs";

const dispatcher = new EnvHttpProxyAgent();
export class KickChatError extends Error {
  constructor(code) { super(`El chat público de Kick no está disponible (${code}). No se registran credenciales ni mensajes privados.`); this.code = code; }
}

/** Read-only public viewer transport; it never exposes a send-chat operation. */
export async function openKickChat({ channelId, chatroomId, signal, request = kickViewerRequest,
  socketFactory = url => new WebSocket(url, { dispatcher, headers: { Origin: "https://kick.com" } }),
  now = Date.now, timeoutMs = 15000 } = {}) {
  if (!/^\d+$/u.test(String(channelId)) || !/^\d+$/u.test(String(chatroomId))) throw new KickChatError("CHAT_IDENTITY_INVALID");
  signal?.throwIfAborted();
  const clientId = randomUUID();
  const connection = await request(`https://web.kick.com/api/v1/realtime/channels/${channelId}/chat/connection`, {
    method: "POST", stage: "CHAT_CONNECTION", signal, body: { client: { id: clientId, type: "web" }, capabilities: { accepted_providers: [{ provider: "centrifugo" }] } },
  });
  const config = connection.data?.connections?.find(c => c.provider === "centrifugo");
  let url;
  try { url = new URL(config?.credentials?.url); } catch { throw new KickChatError("CHAT_ENDPOINT_INVALID"); }
  if (url.protocol !== "wss:" || url.username || url.password || url.port || !/^realtime\.[a-z0-9-]+\.platform\.kick\.com$/u.test(url.hostname)) throw new KickChatError("CHAT_ENDPOINT_INVALID");
  const authorization = await request("https://web.kick.com/api/v1/realtime/auth/connection", {
    method: "POST", stage: "CHAT_AUTHORIZATION", signal, body: { client_id: clientId },
  });
  const token = authorization.data?.token;
  if (typeof token !== "string" || !token || token.length > 16384) throw new KickChatError("CHAT_TOKEN_INVALID");
  const collector = new ChatActivityCollector({ roomId: String(chatroomId), now });
  const state = { status: "CONNECTING", acceptedMessages: 0, duplicateOrOtherMessages: 0, lastMessageAt: null, error: null };
  let subscriptions = 0, rejectedSubscriptions = 0;
  const socket = socketFactory(url.toString()); let closed = false, closedAt = null, timer, settleResolve, settleReject;
  const ready = new Promise((resolve, reject) => { settleResolve = resolve; settleReject = reject; });
  const fail = code => { state.error = code; state.status = "DISCONNECTED"; settleReject(new KickChatError(code)); };
  const close = () => { if (closed) return; closed = true; closedAt = now(); clearTimeout(timer); signal?.removeEventListener("abort", abort); try { socket.close(); } catch { /* Already closed. */ } state.status = "CLOSED"; };
  const abort = () => { fail("CHAT_CANCELLED"); close(); };
  const send = command => { if (!closed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(command)); };
  socket.addEventListener("open", () => send({ id: 1, connect: { token, name: "clipforge-viewer" } }));
  socket.addEventListener("message", event => {
    if (closed) return;
    const raw = String(event.data); if (raw.length > 128 * 1024) return;
    for (const line of raw.split("\n")) {
      let message; try { message = JSON.parse(line); } catch { continue; }
      if (!message || typeof message !== "object") continue;
      if (Object.keys(message).length === 0) { send({}); continue; }
      if (message.id === 1) {
        if (message.error || !message.connect) { fail("CHAT_CONNECT_REJECTED"); close(); return; }
        [`chatroom_${chatroomId}`, `chatrooms.${chatroomId}`, `chatrooms.${chatroomId}.v2`].forEach((channel, index) => send({ id: index + 2, subscribe: { channel } })); continue;
      }
      if ([2, 3, 4].includes(message.id)) {
        if (message.error || !message.subscribe) { rejectedSubscriptions++; if (rejectedSubscriptions === 3 && subscriptions === 0) { fail("CHAT_SUBSCRIBE_REJECTED"); close(); } continue; }
        subscriptions++;
        state.status = "SUBSCRIBED"; clearTimeout(timer); settleResolve(); continue;
      }
      let data = message.push?.pub?.data;
      if (!data) continue;
      try { if (typeof data === "string") data = JSON.parse(data); } catch { continue; }
      if (data?.event !== "App\\Events\\ChatMessageEvent") continue;
      let item = data.data;
      try { if (typeof item === "string") item = JSON.parse(item); } catch { continue; }
      if (collector.add({ id: item?.id, roomId: item?.chatroom_id, senderId: item?.sender?.id, content: item?.content })) {
        state.acceptedMessages++; state.lastMessageAt = new Date(now()).toISOString();
      } else state.duplicateOrOtherMessages++;
    }
  });
  socket.addEventListener("error", () => { if (!closed) fail("CHAT_TRANSPORT_ERROR"); });
  socket.addEventListener("close", () => { if (!closed) { state.status = "DISCONNECTED"; fail("CHAT_CONNECTION_CLOSED"); } });
  timer = setTimeout(() => { fail("CHAT_SUBSCRIBE_TIMEOUT"); close(); }, timeoutMs); timer.unref?.();
  signal?.addEventListener("abort", abort, { once: true });
  try { await ready; }
  catch (error) { close(); throw error; }
  return { snapshot: () => ({ ...state, source: "KICK_PUBLIC_VIEWER", channelId: String(channelId), chatroomId: String(chatroomId), bins: collector.snapshot(closedAt ?? now()) }), close };
}
