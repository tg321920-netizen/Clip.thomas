import test from "node:test";
import assert from "node:assert/strict";
import { resolveKickSource, KickSourceError } from "../services/live/KickPublicSourceService.mjs";
const id = "01a17413-f760-7067-aa90-2e6d458a1aa6";
const videoUrl = `https://kick.com/westcol/videos/${id}`;
const mediaUrl = `https://cdn.example.invalid/master.m3u8?ticket=${"a".repeat(9000)}`;
const channel = { id: 669746, slug: "westcol", chatroom: { id: 669512 }, livestream: null, playback_url: mediaUrl };
const video = { id, status: "public", start_time: "2026-10-25T17:20:28Z", title: "Grabación autorizada de prueba", duration: 10310 };
function setup({ live = false, availability = "public", owner = "669746", encryption = "none", media = mediaUrl } = {}) {
  const calls = [];
  return { calls, validateMediaUrl: async raw => new URL(raw), request: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/info')) return { ...channel, ...(live ? { livestream: { id: 10, start_time: '2026-10-25T17:20:28Z', session_title: 'Directo fixture' } } : {}) };
    if (url.endsWith('/videos')) return { data: [{ ...video, status: availability }] };
    if (url.endsWith('/playback')) return { playback_url: { vod: media }, video_session: { creator_id: owner, video_id: id, video_encryption_type: encryption } };
    assert.fail('Unexpected public endpoint');
  } };
}
test('Kick LIVE metadata is separate from actual HLS acquisition; long source URLs remain intact', async () => {
  const deps = setup({ live: true });
  const source = await resolveKickSource('https://kick.com/westcol', deps);
  assert.equal(source.url, mediaUrl); assert.equal(source.metadata.sourceKind, 'LIVE');
  assert.equal(source.metadata.metadataSource, 'PUBLIC_VIEWER');
  assert.equal(source.metadata.rightsReview, 'REQUIRED');
  assert.equal(deps.calls.length, 1);
});
test('offline channel is not an OAuth failure and does not silently become an old VOD', async () => {
  const deps = setup();
  await assert.rejects(resolveKickSource('https://kick.com/westcol', deps), e => e.code === 'SOURCE_OFFLINE' && e.stage === 'SOURCE_STATE');
  assert.equal(deps.calls.length, 1);
});
test('public VOD is bound to its channel and selected through the normal viewer endpoint', async () => {
  const deps = setup(); const source = await resolveKickSource(videoUrl, deps);
  assert.equal(source.url, mediaUrl); assert.equal(source.metadata.sourceKind, 'VOD');
  assert.equal(source.metadata.sourceId, id); assert.equal(source.metadata.durationSeconds, 10310);
  assert.equal(deps.calls[2].options.method, 'POST');
  assert.equal('Authorization' in (deps.calls[2].options.headers || {}), false);
  assert.doesNotMatch(JSON.stringify(source.metadata), /ticket=|aaa{3}/u);
});
test('private/subscriber media, other creators and encryption do not trigger extraction fallbacks', async () => {
  for (const availability of ['private', 'sub_only']) {
    const deps = setup({ availability });
    await assert.rejects(resolveKickSource(videoUrl, deps), e => e.code === 'SOURCE_ACCESS_DENIED');
    assert.equal(deps.calls.length, 2);
  }
  await assert.rejects(resolveKickSource(videoUrl, setup({ owner: 'other' })), e => e.code === 'SOURCE_METADATA_INVALID');
  await assert.rejects(resolveKickSource(videoUrl, setup({ encryption: 'widevine' })), e => e.code === 'SOURCE_ENCRYPTED');
});
test('public viewer access errors stay explicit without assuming missing credentials', async () => {
  await assert.rejects(resolveKickSource(videoUrl, { request: async () => { throw new KickSourceError('SOURCE_ACCESS_DENIED', 'SOURCE_CHANNEL', 'HTTP 403', 403); } }), e => e.status === 403);
  const deps = setup({ media: 'http://127.0.0.1/private.m3u8' });
  delete deps.validateMediaUrl;
  await assert.rejects(resolveKickSource(videoUrl, deps), e => e.code === 'SOURCE_MEDIA_INVALID');
});
