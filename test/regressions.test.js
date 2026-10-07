const test = require('node:test');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createApp } = require('../backend/server');
const { createGameState, sampleWords, toggleCardMark, setCardConfidence } = require('../backend/game-engine');
const { validatePayload } = require('../backend/payload-schema');
const createTimers = require('../backend/timers');

async function setup(t) {
  const ctx = createApp({ corsOrigin: '*', restoreState: false });
  const clients = [];
  await new Promise(resolve => ctx.httpServer.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${ctx.httpServer.address().port}`;
  t.after(async () => {
    for (const client of clients) client.disconnect();
    clearInterval(ctx.cleanupInterval);
    for (const timer of [...ctx.phaseTimers.values(), ...ctx.mvpTimers.values()]) clearTimeout(timer);
    await new Promise(resolve => ctx.io.close(resolve));
  });
  async function connect() {
    const client = io(origin, { transports: ['websocket'], reconnection: false });
    clients.push(client);
    await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
    return client;
  }
  return { ctx, connect, origin };
}
const emit = (client, event, payload = {}) => client.timeout(2000).emitWithAck(event, payload);

async function game(t) {
  const env = await setup(t);
  const host = await env.connect();
  const guest = await env.connect();
  const created = await emit(host, 'room:create');
  const joined = await emit(guest, 'room:join', { code: created.roomCode });
  await emit(host, 'role:set', { role: 'spymaster', team: 'red' });
  await emit(guest, 'role:set', { role: 'operative', team: 'red' });
  await emit(host, 'game:start');
  const room = env.ctx.rooms.get(created.roomCode);
  for (const client of [host, guest]) await emit(client, 'team:set', { team: room.game.currentTeam });
  return { ...env, host, guest, room, created, joined };
}

test('hint counts must be positive and allow one additional guess', async t => {
  assert.equal(validatePayload('turn:hint_submit', { word: 'example', count: 0 }).ok, false);
  const { host, guest, room } = await game(t);
  for (const count of [0, -1, 1.5]) {
    assert.equal((await emit(host, 'turn:hint_submit', { word: 'notonboard', count })).ok, false);
    assert.equal(room.game.phase, 'hint');
    assert.equal(room.game.hint, null);
  }
  assert.equal((await emit(host, 'turn:hint_submit', { word: 'notonboard', count: 1 })).ok, true);
  assert.equal(room.game.guessesRemaining, 2);
  const card = room.game.board.find(card => card.color === room.game.currentTeam);
  assert.equal((await emit(guest, 'turn:guess', { index: card.index })).ok, true);
  assert.equal(room.game.phase, 'guess');
  assert.equal(room.game.guessesRemaining, 1);
});

test('joining the current solo room is idempotent and retains its player', async t => {
  const { ctx, connect } = await setup(t);
  const host = await connect();
  const created = await emit(host, 'room:create');
  const result = await emit(host, 'room:join', { code: created.roomCode });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, created.sessionId);
  assert.equal(ctx.rooms.get(created.roomCode).players.size, 1);
});

test('disconnected players cannot rejoin beyond room capacity', async t => {
  const { ctx, connect } = await setup(t);
  const host = await connect();
  const created = await emit(host, 'room:create');
  const room = ctx.rooms.get(created.roomCode);
  for (let i = 0; i < 19; i++) room.players.set(`connected-${i}`, { sessionId: `connected-${i}`, connected: true, joinedAt: i });
  room.players.set('returning', { sessionId: 'returning', reconnectToken: 'returning-secret', connected: false, name: 'Returning', joinedAt: 20 });
  const returning = await connect();
  const result = await emit(returning, 'room:rejoin', { code: room.code, sessionId: 'returning', reconnectToken: 'returning-secret' });
  assert.equal(result.ok, false);
  assert.equal(result.error, 'Room is full.');
  assert.equal(room.players.get('returning').connected, false);
});

test('confidence requires a mark and clears on unmarking or changing roles', async t => {
  const { host, guest, room, joined } = await game(t);
  await emit(host, 'turn:hint_submit', { word: 'notonboard', count: 3 });
  assert.equal((await emit(guest, 'turn:mark_confidence', { index: 0, confidence: 'tentative' })).ok, false);
  await emit(guest, 'turn:mark_toggle', { index: 0 });
  assert.equal((await emit(guest, 'turn:mark_confidence', { index: 0, confidence: 'tentative' })).ok, true);
  await emit(guest, 'turn:mark_toggle', { index: 0 });
  assert.equal(room.game.confidenceByCard[0][joined.sessionId], undefined);
  await emit(guest, 'turn:mark_toggle', { index: 0 });
  await emit(guest, 'turn:mark_confidence', { index: 0, confidence: 'tentative' });
  await emit(guest, 'role:set', { role: 'spectator' });
  assert.equal(room.game.marksByCard[0].size, 0);
  assert.equal(room.game.confidenceByCard[0][joined.sessionId], undefined);
});

test('rematches validate players before swapping teams', async t => {
  const { host, guest, room } = await game(t);
  await emit(host, 'turn:hint_submit', { word: 'notonboard', count: 1 });
  await emit(guest, 'turn:guess', { index: room.game.board.find(card => card.color === 'assassin').index });
  const oldGame = room.game;
  await emit(host, 'role:set', { role: 'spectator' });
  await emit(guest, 'role:set', { role: 'spectator' });
  const result = await emit(host, 'game:rematch', { mode: 'swap_teams' });
  assert.equal(result.ok, false);
  assert.equal(room.game, oldGame);
  assert.equal(room.match.roundNumber, 1);
});

test('custom word URLs have no schema or socket handler', async t => {
  assert.equal(validatePayload('room:word_pack_set', { url: 'https://example.test/words' }).ok, false);
  const { ctx, connect } = await setup(t);
  const client = await connect();
  const serverSocket = ctx.io.sockets.sockets.get(client.id);
  assert.equal(serverSocket.listenerCount('room:word_pack_set'), 0);
});

test('old timer callbacks cannot cancel the current phase timer', () => {
  const game = createGameState({ seed: 0 });
  game.phaseTimer = { id: 'current', phase: 'hint' };
  const room = { code: 'TEST', game };
  const handle = setTimeout(() => {}, 10000);
  const phaseTimers = new Map([['TEST', handle]]);
  try {
    createTimers({ rooms: new Map([['TEST', room]]), phaseTimers }).finalizePhaseTimer('TEST', 'expired');
    assert.equal(phaseTimers.get('TEST'), handle);
    assert.equal(game.phaseTimer.id, 'current');
  } finally { clearTimeout(handle); }
});

test('zero is a deterministic seed and board words stay distinct after normalization', () => {
  const first = createGameState({ seed: 0 });
  const second = createGameState({ seed: 0 });
  assert.equal(first.seed, 0);
  assert.deepEqual(first.board, second.board);
  assert.deepEqual(sampleWords(2, () => 0, [' apple ', 'APPLE', 'banana']), ['BANANA', 'APPLE']);
  assert.throws(() => sampleWords(2, () => 0, ['apple', 'APPLE']), /Not enough words/);
  toggleCardMark(first, 'player', 0);
  setCardConfidence(first, 'player', 0, 'tentative');
  toggleCardMark(first, 'player', 0);
  assert.equal(first.confidenceByCard[0].player, undefined);
});

test('retired game aliases stay unavailable while Murmur health remains available', async t => {
  const { origin } = await setup(t);
  for (const prefix of ['taccan', 'wordmurmur']) {
    const response = await fetch(`${origin}/${prefix}/room/ABCD?theater=1`, { redirect: 'manual' });
    assert.equal(response.status, 404);
  }
  for (const prefix of ['taccan', 'wordmurmur']) assert.equal((await fetch(`${origin}/${prefix}/api/health`)).status,404);
  assert.equal((await fetch(`${origin}/murmur/api/health`)).status,200);
});

test('queued actions cannot change a room after the player has left', async t => {
  const { host, room } = await game(t);
  const { withRoomLock } = require('../backend/room-lock');
  let release;
  const blocker = withRoomLock(room.code, () => new Promise(resolve => { release = resolve; }));
  await new Promise(resolve => setImmediate(resolve));
  const hint = emit(host, 'turn:hint_submit', { word: 'notonboard', count: 2 });
  await emit(host, 'room:leave');
  release();
  await blocker;
  assert.equal((await hint).ok, false);
  assert.equal(room.game.hint, null);
});

test('public player identifiers cannot steal a guest seat and private proof survives reconnect', async t => {
  const { ctx, connect } = await setup(t);
  const host = await connect();
  const attacker = await connect();
  const created = await emit(host, 'room:create', { name: 'Host' });
  let snapshot;
  attacker.on('state:full', value => { snapshot = value; });
  await emit(attacker, 'room:join', { code: created.roomCode });
  const publicHost = snapshot.players.find(player => player.sessionId === created.sessionId);
  assert.equal(publicHost.reconnectToken, undefined);
  assert.ok(snapshot.me.reconnectToken);
  for (const proof of [undefined, 'incorrect']) {
    const result = await emit(attacker, 'room:rejoin', { code: created.roomCode, sessionId: publicHost.sessionId, reconnectToken: proof });
    assert.equal(result.ok, false);
    assert.equal(host.connected, true);
    assert.equal(ctx.rooms.get(created.roomCode).players.get(created.sessionId).name, 'Host');
  }
  const disconnected = new Promise(resolve => ctx.io.sockets.sockets.get(host.id).once('disconnect', resolve));
  host.disconnect();
  await disconnected;
  const returning = await connect();
  const result = await emit(returning, 'room:rejoin', { code: created.roomCode, sessionId: created.sessionId, reconnectToken: created.reconnectToken });
  assert.equal(result.ok, true);
  assert.equal(result.sessionId, created.sessionId);
});

test('voice presence and speaking reach observers and stay isolated to the room', { timeout: 5000 }, async t => {
  const { ctx, connect } = await setup(t);
  const speaker = await connect(), observer = await connect(), outsider = await connect();
  const created = await emit(speaker, 'room:create');
  await emit(observer, 'room:join', { code: created.roomCode });
  await emit(outsider, 'room:create');
  const unrelated = [];
  outsider.on('voice:status', event => unrelated.push(event));
  outsider.on('voice:speaking_changed', event => unrelated.push(event));
  assert.equal((await emit(observer, 'voice:speaking', { speaking: true })).ok, false);
  const status = inVoice => new Promise(resolve => {
    const handler = event => {
      if (inVoice !== undefined && event.inVoice !== inVoice) return;
      observer.off('voice:status', handler);
      resolve(event);
    };
    observer.on('voice:status', handler);
  });
  const joined = status();
  assert.equal((await emit(speaker, 'voice:join')).ok, true);
  assert.deepEqual(await joined, { sessionId: created.sessionId, inVoice: true, muted: false, speaking: false });
  const speaking = new Promise(resolve => observer.once('voice:speaking_changed', resolve));
  assert.equal((await emit(speaker, 'voice:speaking', { speaking: true })).ok, true);
  assert.deepEqual(await speaking, { sessionId: created.sessionId, speaking: true });
  const muted = status();
  await emit(speaker, 'voice:mute', { muted: true });
  assert.deepEqual(await muted, { sessionId: created.sessionId, inVoice: true, muted: true, speaking: false });
  await emit(speaker, 'voice:speaking', { speaking: true });
  assert.equal(ctx.rooms.get(created.roomCode).voiceSpeaking.has(created.sessionId), false);
  const newcomer = await connect();
  const snapshot = new Promise(resolve => newcomer.once('state:full', resolve));
  await emit(newcomer, 'room:join', { code: created.roomCode });
  const player = (await snapshot).players.find(player => player.sessionId === created.sessionId);
  assert.equal(player.inVoice, true);
  assert.equal(player.voiceMuted, true);
  assert.equal(player.speaking, false);
  const left = status();
  await emit(speaker, 'voice:leave');
  assert.deepEqual(await left, { sessionId: created.sessionId, inVoice: false, muted: false, speaking: false });
  await emit(speaker, 'voice:join');
  const disconnected = status(false);
  speaker.disconnect();
  assert.equal((await disconnected).inVoice, false);
  assert.deepEqual(unrelated, []);
});
