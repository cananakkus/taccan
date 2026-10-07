const test = require('node:test');
const assert = require('node:assert/strict');
const { createHmac } = require('node:crypto');
const { createServer } = require('node:http');
const { io } = require('socket.io-client');
const { createApp } = require('../backend/server');
const { createVoiceInfrastructure } = require('../backend/voice-infrastructure');

const secret = 'private-test-account-secret';
const voiceEnv = { TURN_HOST: 'turn.example.test', TURN_SHARED_SECRET: 'private-test-turn-secret' };
function proof({ sub = 'verified-user', name = 'Verified', exp = Math.floor(Date.now() / 1000) + 300, aud = 'taccan' } = {}) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'wleeaf-play', aud, sub, name, exp })).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
}
const emit = (client, event, payload = {}) => client.timeout(2000).emitWithAck(event, payload);
async function setup(t, options = {}) {
  const ctx = createApp({ corsOrigin: '*', restoreState: false, accountSecret: secret, voiceEnv, ...options });
  const clients = [];
  await new Promise(resolve => ctx.httpServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${ctx.httpServer.address().port}`;
  t.after(async () => {
    clients.forEach(client => client.disconnect());
    clearInterval(ctx.cleanupInterval);
    for (const timer of [...ctx.phaseTimers.values(), ...ctx.mvpTimers.values()]) clearTimeout(timer);
    await new Promise(resolve => ctx.io.close(resolve));
  });
  async function connect(auth = {}) {
    const client = io(origin, { transports: ['websocket'], reconnection: false, auth });
    clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  }
  return { ctx, origin, connect };
}

test('verified accounts own seats, names, and reconnects; proofs cannot switch identity', async t => {
  const { ctx, connect } = await setup(t);
  const owner = await connect({ accountToken: proof() });
  const guest = await connect();
  const created = await emit(owner, 'room:create', { name: 'Spoofed' });
  const room = ctx.rooms.get(created.roomCode);
  assert.equal(room.players.get(created.sessionId).name, 'Verified');
  assert.equal(room.players.get(created.sessionId).accountId, 'verified-user');
  assert.equal((await emit(guest, 'room:rejoin', { code: created.roomCode, sessionId: created.sessionId, reconnectToken: created.reconnectToken })).ok, false);
  assert.equal((await emit(owner, 'account:refresh', { token: proof({ sub: 'different-user' }) })).ok, false);
  assert.equal((await emit(owner, 'account:refresh', { token: proof({ name: 'Updated' }) })).ok, true);
  assert.equal(room.players.get(created.sessionId).name, 'Updated');
  const returned = await connect({ accountToken: proof() });
  assert.equal((await emit(returned, 'room:rejoin', { code: created.roomCode, sessionId: created.sessionId })).ok, true);
  assert.equal(room.players.get(created.sessionId).socketId, returned.id);
});

test('account renewal keeps the same room, socket, and call beyond the old proof expiry', { timeout: 6000 }, async t => {
  const { ctx, connect } = await setup(t);
  const exp = Math.floor(Date.now() / 1000) + 2;
  const client = await connect({ accountToken: proof({ exp }) });
  const created = await emit(client, 'room:create');
  await emit(client, 'voice:join');
  const socketId = client.id;
  assert.equal((await emit(client, 'account:refresh', { token: proof() })).ok, true);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, exp * 1000 - Date.now()) + 100));
  assert.equal(client.connected, true);
  assert.equal(client.id, socketId);
  assert.equal(ctx.rooms.get(created.roomCode).voicePeers.has(created.sessionId), true);
});

test('expired proofs and account-service failures cannot silently create guest sockets', async t => {
  const { connect } = await setup(t);
  await assert.rejects(connect({ accountToken: proof({ exp: 1 }) }), /expired/);
  await assert.rejects(connect({ accountToken: proof({ aud: 'wess' }) }), /expired/);
  await assert.rejects(connect({ accountUnavailable: true }), /unavailable/);
});

test('relay issuance requires room and voice membership; the old HTTP route exposes no relay', async t => {
  const { connect, origin } = await setup(t);
  const client = await connect();
  assert.equal((await emit(client, 'voice:join')).ok, false);
  await emit(client, 'room:create');
  assert.equal((await emit(client, 'voice:credentials')).ok, false);
  const joined = await emit(client, 'voice:join');
  assert.equal(joined.ok, true);
  const relay = joined.iceServers.find(server => server.username);
  assert.ok(relay);
  assert.ok(joined.expiresAt > Date.now() && joined.expiresAt <= Date.now() + 600_000);
  assert.equal(relay.credential, createHmac('sha1', voiceEnv.TURN_SHARED_SECRET).update(relay.username).digest('base64'));
  assert.equal((await emit(client, 'voice:credentials')).ok, true);
  const publicConfig = await (await fetch(`${origin}/murmur/api/turn-credentials`)).json();
  assert.ok(publicConfig.iceServers.every(server => !server.username && !server.credential));
  await emit(client, 'voice:leave');
  assert.equal((await emit(client, 'voice:credentials')).ok, false);
});

test('the authorization adapter can cover every guest using a verified account outside voice', async t => {
  const { ctx, connect } = await setup(t, {
    authorizeVoice: ({ members }) => ({ allowed: members.some(member => member.account?.id === 'sponsor') }),
  });
  const guest = await connect();
  const created = await emit(guest, 'room:create');
  assert.equal((await emit(guest, 'voice:join', { premium: true, accountId: 'sponsor' })).ok, false);
  const sponsor = await connect({ accountToken: proof({ sub: 'sponsor' }) });
  const joinedSponsor = await emit(sponsor, 'room:join', { code: created.roomCode });
  assert.equal((await emit(guest, 'voice:join')).ok, true);
  assert.equal(ctx.rooms.get(created.roomCode).voicePeers.has(joinedSponsor.sessionId), false);
  await emit(sponsor, 'room:leave');
  assert.equal((await emit(guest, 'voice:credentials')).ok, false);
});

test('pending voice authorization cannot re-add a player after voice leave', async t => {
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  let delayed = true;
  const { connect, ctx } = await setup(t, { authorizeVoice: async () => {
    if (delayed) { delayed = false; entered(); await new Promise(resolve => { release = resolve; }); }
    return { allowed: true };
  } });
  const client = await connect();
  const created = await emit(client, 'room:create');
  const joining = emit(client, 'voice:join');
  await waiting;
  await emit(client, 'voice:leave');
  release();
  assert.equal((await joining).ok, false);
  assert.equal(ctx.rooms.get(created.roomCode).voicePeers?.size || 0, 0);
});

test('pending voice authorization cannot return credentials to a former room member', async t => {
  let release;
  let entered;
  const waiting = new Promise(resolve => { entered = resolve; });
  let delayed = true;
  const { connect, ctx } = await setup(t, { authorizeVoice: async () => {
    if (delayed) { delayed = false; entered(); await new Promise(resolve => { release = resolve; }); }
    return { allowed: true };
  } });
  const client = await connect();
  const created = await emit(client, 'room:create');
  const room = ctx.rooms.get(created.roomCode);
  const joining = emit(client, 'voice:join');
  await waiting;
  await emit(client, 'room:leave');
  release();
  const result = await joining;
  assert.equal(result.ok, false);
  assert.equal(result.iceServers, undefined);
  assert.equal(room.voicePeers?.size || 0, 0);
});

test('shared voice adapter uses the private broker and fails closed if it is unavailable', async t => {
  let received;
  const broker = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received = { path: req.url, authorization: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks)) };
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ iceServers: [{ urls: 'turn:turn.example.test', username: 'derived', credential: 'derived' }], expiresAt: Date.now() + 600_000 }));
  });
  await new Promise(resolve => broker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => broker.close(resolve)));
  const infrastructure = createVoiceInfrastructure({ env: { VOICE_SERVICE_URL: `http://127.0.0.1:${broker.address().port}`, VOICE_SERVICE_KEY: 'private-app-key' } });
  const result = await infrastructure.credentials({ roomId: 'ABCD', playerId: 'player' });
  assert.equal(result.iceServers[0].username, 'derived');
  assert.deepEqual(received, { path: '/v1/credentials', authorization: 'Bearer private-app-key', body: { application: 'taccan', roomId: 'ABCD', playerId: 'player' } });
  await new Promise(resolve => broker.close(resolve));
  await assert.rejects(infrastructure.credentials({ roomId: 'ABCD', playerId: 'player' }));
  assert.throws(() => createVoiceInfrastructure({ env: { VOICE_SERVICE_URL: 'http://example.test' } }), /together/);
});
