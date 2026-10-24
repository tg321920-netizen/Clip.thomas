import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveAdapter } from '../services/live/LiveSourceService.mjs';
import { scoreCandidate } from '../services/analysis/ViralScoreService.mjs';
import { sceneActivity } from '../services/analysis/AudioEnergyService.mjs';

for (const [platform, raw, variables, payload] of [
  ['KICK', 'https://kick.com/owner', { KICK_ACCESS_TOKEN: 'test-token' }, { data: [{ broadcaster_user_id: 1, stream: { is_live: true } }] }],
  ['TWITCH', 'https://www.twitch.tv/owner', { TWITCH_CLIENT_ID: 'test-client', TWITCH_ACCESS_TOKEN: 'test-token' }, { data: [{ user_id: '2', title: 'Authorized fixture' }] }],
  ['YOUTUBE', 'https://youtube.com/watch?v=abcdefghijk', { YOUTUBE_API_KEY: 'test-key' }, { items: [{ snippet: {}, liveStreamingDetails: { actualStartTime: '2026-10-24T00:00:00Z' } }] }],
]) {
  test(`${platform}: independent official adapter detects live and offline, with explicit missing credentials`, async () => {
    const previous = Object.fromEntries(Object.keys(variables).map(key => [key, process.env[key]]));
    try {
      Object.assign(process.env, variables);
      const url = new URL(raw);
      const adapter = createLiveAdapter(url, { request: async endpoint => { assert.match(endpoint, /^https:\/\//); return payload; } });
      assert.equal((await adapter.inspect(url)).state, 'LIVE');
      const offlinePayload = platform === 'KICK' ? { data: [{ stream: { is_live: false } }] } : platform === 'TWITCH' ? { data: [] } : { items: [{ liveStreamingDetails: { actualStartTime: 'yesterday', actualEndTime: 'today' } }] };
      const offline = await createLiveAdapter(url, { request: async () => offlinePayload }).inspect(url);
      assert.equal(offline.state, platform === 'YOUTUBE' ? 'ENDED' : 'OFFLINE');
      for (const key of Object.keys(variables)) delete process.env[key];
      assert.equal((await adapter.inspect(url)).state, 'UNCONFIGURED');
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
}

test('platform spoofing, unsupported hosts and malformed YouTube identifiers are rejected', async () => {
  assert.throws(() => createLiveAdapter(new URL('https://kick.com.attacker.example/owner')));
  await assert.rejects(createLiveAdapter(new URL('https://youtube.com/watch?v=bad')).inspect(new URL('https://youtube.com/watch?v=bad')), /enlace/);
});

test('profiles retain measurable evidence, missing signals and redundancy penalties', () => {
  const candidate = { text: 'Why did we win the game? Practice is the reason for this victory.', duration: 30, audioEnergy: 40, visualActivity: 20, contentProfile: 'GAMING' };
  const score = scoreCandidate(candidate);
  assert.equal(score.components.profileRelevance, 80);
  assert.equal(score.components.audioEnergy, 40);
  assert.ok(score.missingSignals.includes('chatActivity'));
  assert.ok(score.reasons.some(reason => reason.includes('RMS')));
  assert.equal(scoreCandidate(candidate, { redundancyPenalty: 12 }).viralScore, score.baseScore - 12);
  assert.equal(sceneActivity(candidate, null), null);
  assert.equal(sceneActivity({ startTime: 0, endTime: 30, duration: 30 }, []), 0);
});
