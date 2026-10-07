const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { getIceServers } = require('../backend/turn-config');

test('shared-secret TURN configuration issues expiring signed credentials', () => {
  const env = { TURN_HOST: 'turn.example.com', TURN_SHARED_SECRET: 'test-secret' };
  const servers = getIceServers(env, 1700000000000);
  const relay = servers.find(server => server.username);
  assert.match(relay.username, /^1700000600:[a-f0-9]{32}$/);
  assert.equal(relay.credential, createHmac('sha1', 'test-secret').update(relay.username).digest('base64'));
  assert.deepEqual(relay.urls, ['turn:turn.example.com:3478', 'turn:turn.example.com:3478?transport=tcp']);
  assert.ok(!JSON.stringify(servers).includes('test-secret'));
  assert.notEqual(getIceServers(env, 1700000001000).at(-1).credential, relay.credential);
});

test('credentials isolate room participants and bound their lifetime', () => {
  const env = { TURN_HOST: 'turn.example.com', TURN_SHARED_SECRET: 'test-secret' };
  const first = getIceServers(env, 1700000000000, { subject: 'one', ttlSeconds: 120 }).at(-1);
  const second = getIceServers(env, 1700000000000, { subject: 'two', ttlSeconds: 120 }).at(-1);
  assert.notEqual(first.username, second.username);
  assert.match(first.username, /^1700000120:/);
  for (const ttlSeconds of [1, 120.5, 3601, NaN]) assert.throws(() => getIceServers(env, Date.now(), { ttlSeconds }), /TTL/);
});

test('static TURN credentials remain compatible', () => {
  const relay = getIceServers({ TURN_HOST: 'turn.example.com', TURN_USERNAME: 'user', TURN_CREDENTIAL: 'password' }).at(-1);
  assert.equal(relay.username, 'user');
  assert.equal(relay.credential, 'password');
});

test('incomplete TURN configuration returns only STUN servers', () => {
  for (const env of [{}, { TURN_HOST: 'turn.example.com' }, { TURN_SHARED_SECRET: 'secret' }]) {
    assert.equal(getIceServers(env).length, 2);
  }
});
