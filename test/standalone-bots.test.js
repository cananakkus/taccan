const test = require('node:test'), assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createApp } = require('../backend/server');
const { restoreRooms } = require('../backend/state-persistence');
const { PACE } = require('../backend/bots');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function boot(options = {}) {
  const app = createApp({ restoreState: false, corsOrigin: '*', botDelayScale: 0.01, ...options });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  app.base = 'http://127.0.0.1:' + app.httpServer.address().port;
  app.clients = [];
  app.connect = async () => { const s = io(app.base, { transports: ['websocket'], forceNew: true, reconnection: false }); app.clients.push(s); s.on('state:full', (st) => { s.state = st; }); await new Promise((r) => s.once('connect', r)); return s; };
  app.stop = async () => { app.clients.forEach((c) => c.disconnect()); for (const t of app.phaseTimers.values()) clearTimeout(t); await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval); };
  return app;
}
const ack = (s, event, payload) => new Promise((resolve) => s.timeout(3000).emit(event, payload, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res)));
async function until(fn, ms = 8000) { for (const end = Date.now() + ms; Date.now() < end; await sleep(10)) if (fn()) return true; return false; }

test('hosts seat bots in a normal room; bots play both roles and a lone person can finish a game', async () => {
  const app = await boot();
  try {
    const host = await app.connect(), guest = await app.connect();
    const { roomCode } = await ack(host, 'room:create', { name: 'Ada' });
    await ack(guest, 'room:join', { code: roomCode, name: 'Bo' });
    assert.equal((await ack(guest, 'room:bot_add', { team: 'red' })).error, 'Only the host can seat or remove bots.');
    assert.equal((await ack(host, 'room:bot_add', { team: 'green' })).ok, false);
    const redSpy = await ack(host, 'room:bot_add', { team: 'red', skill: 'hard' });
    assert.equal(redSpy.role, 'spymaster', 'an empty spymaster seat goes to the bot');
    const blueSpy = await ack(host, 'room:bot_add', { team: 'blue', skill: 'easy' });
    const blueOp = await ack(host, 'room:bot_add', { team: 'blue' });
    assert.equal(blueOp.role, 'operative');
    const room = app.rooms.get(roomCode);
    assert.equal(room.players.get(blueOp.sessionId).skill, 'normal');
    assert.notEqual(redSpy.name, blueSpy.name);
    // A person claiming the bot's spymaster seat takes it; the bot steps down.
    assert.equal((await ack(guest, 'role:set', { role: 'spymaster', team: 'blue' })).ok, true);
    assert.equal(room.players.get(blueSpy.sessionId).role, 'operative');
    assert.equal((await ack(guest, 'role:set', { role: 'spectator' })).ok, true);
    assert.equal((await ack(host, 'room:bot_remove', { sessionId: blueSpy.sessionId })).ok, true);
    const blueSpy2 = await ack(host, 'room:bot_add', { team: 'blue', skill: 'easy' });
    assert.equal(blueSpy2.role, 'spymaster');
    assert.equal((await ack(host, 'room:bot_remove', { sessionId: guest.state.me.sessionId })).ok, false, 'people cannot be removed as bots');
    // Bots are listed, flagged and connected.
    await until(() => host.state?.players.filter((p) => p.bot).length === 3);
    assert.ok(host.state.players.filter((p) => p.bot).every((p) => p.connected && p.skill));
    // Ada plays red operative with a hard bot spymaster against two blue bots.
    await ack(host, 'role:set', { role: 'operative', team: 'red' });
    assert.equal((await ack(host, 'game:start', {})).ok, true);
    // Guess the first open card once per clue, then pass.
    const play = () => {
      const st = host.state, g = st?.game;
      if (host.busy || g?.phase !== 'guess' || g.currentTeam !== 'red' || st.me.role !== 'operative') return;
      host.busy = true;
      const card = g.board.find((c) => !c.revealed);
      ack(host, g.guessesRemaining > g.hint.count ? 'turn:guess' : 'turn:end', { index: card.index }).finally(() => { host.busy = false; setTimeout(play, 5); });
    };
    host.on('state:full', () => setTimeout(play, 5));
    play();
    assert.ok(await until(() => room.game.phase === 'finished', 20000), 'the game finishes');
    const hints = room.game.history.filter((e) => e.type === 'hint');
    assert.ok(hints.some((e) => e.by === redSpy.sessionId) && hints.some((e) => e.by === blueSpy2.sessionId));
    // A bot operative marks its pick before revealing it.
    const history = room.game.history;
    for (const [i, e] of history.entries()) {
      if (e.type !== 'guess' || e.by !== blueOp.sessionId) continue;
      assert.ok(history.slice(0, i).some((m) => m.type === 'mark_toggle' && m.by === blueOp.sessionId && m.index === e.index && m.marked), 'marked first');
    }
  } finally { await app.stop(); }
});

test('bots in a normal room wait while nobody is connected, persist, and leave with the last person', async () => {
  const app = await boot();
  try {
    const host = await app.connect();
    const { roomCode, sessionId, reconnectToken } = await ack(host, 'room:create', { name: 'Ada' });
    await ack(host, 'room:bot_add', { team: 'red' }); await ack(host, 'room:bot_add', { team: 'blue' }); await ack(host, 'room:bot_add', { team: 'blue' });
    await ack(host, 'role:set', { role: 'spectator' });
    for (let i = 0; i < 3; i += 1) assert.equal((await ack(host, 'room:bot_add', { team: 'red' })).ok, true);
    assert.match((await ack(host, 'room:bot_add', { team: 'red' })).error, /at most 6 bots/);
    assert.equal((await ack(host, 'game:start', {})).ok, true);
    const room = app.rooms.get(roomCode);
    assert.ok(await until(() => room.game.history.some((e) => e.type === 'guess')), 'bots play on their own');
    host.disconnect();
    await sleep(60);
    const frozen = room.game.history.length;
    await sleep(400);
    assert.equal(room.game.history.length, frozen, 'no bot moves while nobody is connected');
    // Saved and restored: bots come back connected.
    const restored = restoreRooms(JSON.parse(JSON.stringify([{ ...room, players: [...room.players.values()], game: { ...room.game, marksByCard: room.game.marksByCard.map((s) => [...s]) } }]))).get(roomCode);
    assert.ok([...restored.players.values()].filter((p) => p.bot).every((p) => p.connected));
    assert.ok([...restored.players.values()].filter((p) => !p.bot).every((p) => !p.connected));
    const back = await app.connect();
    assert.equal((await ack(back, 'room:rejoin', { code: roomCode, sessionId, reconnectToken })).ok, true);
    assert.ok(await until(() => room.game.history.length > frozen || room.game.phase === 'finished'), 'bots resume');
    assert.equal((await ack(back, 'room:leave', {})).ok, true);
    assert.equal(app.rooms.has(roomCode), false, 'a room with only bots left is closed');
  } finally { await app.stop(); }
});

test('bot pacing is readable: clues take seconds, picks are shown before they are revealed', () => {
  assert.ok(PACE.hint[0] >= 4000, 'a clue never comes instantly');
  assert.ok(PACE.aim[0] + PACE.reveal[0] >= 2500, 'each guess takes a couple of seconds');
});

test('under a blitz clock bots act well before the phase runs out', async () => {
  const app = await boot({ botDelayScale: 1 });
  try {
    const host = await app.connect();
    const { roomCode } = await ack(host, 'room:create', { name: 'Ada' });
    await ack(host, 'room:mode_set', { mode: 'blitz' });
    await ack(host, 'room:blitz_config', { hintTimerSec: 6, guessTimerSec: 9 });
    await ack(host, 'room:bot_add', { team: 'red' }); await ack(host, 'room:bot_add', { team: 'red' });
    await ack(host, 'room:bot_add', { team: 'blue' }); await ack(host, 'room:bot_add', { team: 'blue' });
    await ack(host, 'role:set', { role: 'spectator' });
    assert.equal((await ack(host, 'game:start', {})).ok, true);
    const room = app.rooms.get(roomCode);
    assert.ok(await until(() => room.game.history.some((e) => e.type === 'hint'), 4000), 'the bot spymaster beats a 6 s clock');
    assert.equal(room.game.history.some((e) => e.type === 'turn_end' && e.reason === 'hint_timeout'), false);
  } finally { await app.stop(); }
});
