import test from 'node:test';
import assert from 'node:assert/strict';
import { KickLiveAdapter, KickAppTokenProvider } from '../services/live/adapters/KickLiveAdapter.mjs';
import { inspectLiveSource } from '../services/live/LiveSourceService.mjs';

const env = { KICK_CLIENT_ID: 'fixture-app-id', KICK_CLIENT_SECRET: 'fixture-app-secret' };
const url = new URL('https://kick.com/authorized-fixture');
const live = { data: [{ broadcaster_user_id: 123, stream_title: 'Authorized fixture', stream: { is_live: true } }] };
const issued = token => ({ access_token: token, token_type: 'Bearer', expires_in: 3600 });
const denied = status => Object.assign(new Error(`La API oficial respondió HTTP ${status}.`), { status, code: 'PLATFORM_ACCESS_DENIED' });

test('Kick app credentials use only the official form POST; status contains no credentials or tokens', async () => {
  let calls = 0;
  const adapter = new KickLiveAdapter({ env, tokenProvider: new KickAppTokenProvider(), request: async (endpoint, headers, options) => {
    calls++;
    if (endpoint === 'https://id.kick.com/oauth/token') {
      assert.deepEqual(headers, { 'Content-Type': 'application/x-www-form-urlencoded' });
      assert.equal(options.method, 'POST');
      assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { grant_type: 'client_credentials', client_id: env.KICK_CLIENT_ID, client_secret: env.KICK_CLIENT_SECRET });
      return issued('fixture-issued-token');
    }
    assert.equal(endpoint, 'https://api.kick.com/public/v1/channels?slug=authorized-fixture');
    assert.deepEqual(headers, { Authorization: 'Bearer fixture-issued-token' });
    return live;
  } });
  const status = await adapter.inspect(url);
  assert.equal(status.state, 'LIVE');
  assert.equal(calls, 2);
  for (const secret of [env.KICK_CLIENT_SECRET, 'fixture-issued-token']) {
    assert.ok(!JSON.stringify(status).includes(secret));
    assert.ok(!JSON.stringify(adapter).includes(secret));
  }
});

test('manual Kick tokens remain usable without app credentials or token exchange', async () => {
  const status = await inspectLiveSource(url.href, { env: { ...env, KICK_ACCESS_TOKEN: 'manual-fixture-token' }, request: async (endpoint, headers, options) => {
    assert.match(endpoint, /^https:\/\/api\.kick\.com\/public\/v1\/channels\?/);
    assert.equal(options, undefined);
    assert.equal(headers.Authorization, 'Bearer manual-fixture-token');
    return live;
  } });
  assert.equal(status.state, 'LIVE');
});

test('Kick reports incomplete credentials without making a request', async () => {
  for (const incomplete of [{}, { KICK_CLIENT_ID: 'fixture-id' }, { KICK_CLIENT_SECRET: 'fixture-secret' }]) {
    const status = await inspectLiveSource(url.href, { env: incomplete, request: async () => assert.fail('No request is allowed without configured credentials') });
    assert.equal(status.state, 'UNCONFIGURED');
  }
});

test('concurrent inspections share one app token; expiry and credential rotation renew it', async () => {
  let now = 0;
  let exchanges = 0;
  const provider = new KickAppTokenProvider({ now: () => now });
  const request = async endpoint => {
    if (endpoint === 'https://id.kick.com/oauth/token') {
      exchanges++;
      await new Promise(resolve => setImmediate(resolve));
      return issued(`fixture-token-${exchanges}`);
    }
    return live;
  };
  const inspect = (credentials = env) => new KickLiveAdapter({ env: credentials, request, tokenProvider: provider }).inspect(url);
  await Promise.all([inspect(), inspect(), inspect()]);
  assert.equal(exchanges, 1);
  now = 3500_000;
  await inspect();
  assert.equal(exchanges, 1);
  now = 3571_000;
  await inspect();
  assert.equal(exchanges, 2);
  await inspect({ ...env, KICK_CLIENT_SECRET: 'rotated-fixture-secret' });
  assert.equal(exchanges, 3);
  await inspect({ ...env, KICK_CLIENT_ID: 'different-fixture-app' });
  assert.equal(exchanges, 4);
});

test('a revoked app token is renewed once; repeated 401s stop and a 403 is not retried', async () => {
  for (const failure of ['once', 'always', 'forbidden']) {
    let exchanges = 0;
    let inspections = 0;
    const request = async endpoint => {
      if (endpoint === 'https://id.kick.com/oauth/token') return issued(`fixture-token-${++exchanges}`);
      inspections++;
      if (failure === 'forbidden') throw denied(403);
      if (failure === 'always' || inspections === 1) throw denied(401);
      return live;
    };
    const status = await inspectLiveSource(url.href, { env, request, kickTokenProvider: new KickAppTokenProvider() });
    assert.equal(status.state, failure === 'once' ? 'LIVE' : 'ACCESS_DENIED');
    assert.equal(exchanges, failure === 'forbidden' ? 1 : 2);
    assert.equal(inspections, failure === 'forbidden' ? 1 : 2);
  }
});

test('a rejected manual token does not silently use the app credentials', async () => {
  let calls = 0;
  const status = await inspectLiveSource(url.href, { env: { ...env, KICK_ACCESS_TOKEN: 'invalid-fixture-manual-token' }, request: async endpoint => {
    calls++;
    assert.match(endpoint, /^https:\/\/api\.kick\.com\//);
    throw denied(401);
  } });
  assert.equal(status.state, 'ACCESS_DENIED');
  assert.equal(calls, 1);
});

test('OAuth failure bodies and secrets do not reach the status; a failed exchange can be retried', async () => {
  let exchanges = 0;
  const request = async endpoint => {
    if (endpoint !== 'https://id.kick.com/oauth/token') return live;
    if (++exchanges === 1) throw Object.assign(new Error(`provider-body ${env.KICK_CLIENT_SECRET}`), { code: 'PLATFORM_ACCESS_DENIED' });
    return issued('fixture-recovered-token');
  };
  const options = { env, request, kickTokenProvider: new KickAppTokenProvider() };
  const failure = await inspectLiveSource(url.href, options);
  assert.equal(failure.state, 'ACCESS_DENIED');
  assert.ok(!JSON.stringify(failure).includes(env.KICK_CLIENT_SECRET));
  assert.ok(!JSON.stringify(failure).includes('provider-body'));
  assert.equal((await inspectLiveSource(url.href, options)).state, 'LIVE');
});

test('invalid tokens, token types and lifetimes never reach the channels endpoint', async () => {
  for (const invalid of [null, {}, { ...issued('fixture-token'), expires_in: 0 }, { ...issued('fixture-token'), expires_in: 'not-a-duration' }, { ...issued('fixture-token'), token_type: 'Basic' }, issued('invalid\r\ntoken')]) {
    let calls = 0;
    const adapter = new KickLiveAdapter({ env, tokenProvider: new KickAppTokenProvider(), request: async endpoint => {
      calls++;
      assert.equal(endpoint, 'https://id.kick.com/oauth/token');
      return invalid;
    } });
    await assert.rejects(adapter.inspect(url), /token de aplicación válido/);
    assert.equal(calls, 1);
  }
});
