import test from 'node:test';
import assert from 'node:assert/strict';
import { openKickChat } from '../services/live/KickChatSource.mjs';

class ViewerSocket extends EventTarget {
  readyState = 0; commands = [];
  constructor({ reject = false } = {}) { super(); this.reject = reject; }
  send(raw) {
    const command = JSON.parse(raw); this.commands.push(command);
    if (command.id) queueMicrotask(() => this.receive(this.reject ? { id: command.id, error: { code: 103 } } :
      command.connect ? { id: command.id, connect: { client: 'public-client' } } : { id: command.id, subscribe: {} }));
  }
  receive(data) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })); }
  publish(id, room, sender = 10) { this.receive({ push: { pub: { data: { event: 'App\\Events\\ChatMessageEvent', data: JSON.stringify({ id, chatroom_id: room, sender: { id: sender }, content: 'JAJAJA' }) } } } }); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
function dependencies(socket) {
  const requests = [];
  return { requests, socketFactory: () => { queueMicrotask(() => { socket.readyState = 1; socket.dispatchEvent(new Event('open')); }); return socket; }, request: async (url, options) => {
    requests.push({ url, options });
    return url.endsWith('/auth/connection') ? { data: { token: 'public-test-connection-token' } } :
      { data: { mode: 'websocket', connections: [{ provider: 'centrifugo', credentials: { url: 'wss://realtime.us-east-1.platform.kick.com/connection/websocket' } }] } };
  } };
}
test('Kick public chat subscribes read-only, filters the chosen room and deduplicates message deliveries', async () => {
  const socket = new ViewerSocket(), deps = dependencies(socket);
  const chat = await openKickChat({ channelId: '669746', chatroomId: '669512', ...deps });
  try {
    assert.equal(chat.snapshot().status, 'SUBSCRIBED');
    socket.publish('one', '669512'); socket.publish('one', '669512'); socket.publish('two', 'another-room');
    assert.equal(chat.snapshot().acceptedMessages, 1);
    assert.equal(chat.snapshot().duplicateOrOtherMessages, 2);
    assert.ok(socket.commands.every(command => command.connect || command.subscribe));
    assert.equal('send' in chat, false);
    assert.equal(deps.requests[0].options.body.client.id, deps.requests[1].options.body.client_id);
    assert.doesNotMatch(JSON.stringify(chat.snapshot()), /public-test-connection-token|JAJAJA/u);
  } finally { chat.close(); }
});
test('closed chat freezes coverage so a partial bucket cannot become complete after closing', async () => {
  let now = Date.parse('2026-10-25T17:00:01Z');
  const socket = new ViewerSocket(), deps = dependencies(socket);
  const chat = await openKickChat({ channelId: '669746', chatroomId: '669512', now: () => now, ...deps });
  socket.publish('one', '669512'); chat.close(); now += 60000;
  assert.equal(chat.snapshot().bins[0].complete, false);
  socket.publish('late', '669512'); assert.equal(chat.snapshot().acceptedMessages, 1);
});
test('rejected subscriptions and unsafe endpoints never masquerade as connected chat', async () => {
  const socket = new ViewerSocket({ reject: true }), deps = dependencies(socket);
  await assert.rejects(openKickChat({ channelId: '669746', chatroomId: '669512', ...deps }), e => e.code === 'CHAT_CONNECT_REJECTED');
  await assert.rejects(openKickChat({ channelId: '669746', chatroomId: '669512', request: async () =>
    ({ data: { connections: [{ provider: 'centrifugo', credentials: { url: 'wss://127.0.0.1/private' } }] } }) }), e => e.code === 'CHAT_ENDPOINT_INVALID');
});
