// Protocol fuzzing. No single message, from any socket in any phase, may crash
// the process, throw inside a handler, or corrupt a room. Covers every event
// with hostile payloads and fields, raw junk frames, oversize frames and floods.
const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs'); const { join } = require('node:path');
const WebSocket = require('ws');
const { io } = require('socket.io-client'); const { createApp } = require('../backend/server');
const secret = 'fuzzfuzz'.repeat(5);

const EVENTS = {
  'player:identity': { name: 'Fz', color: '#123456' },
  'account:refresh': { token: 'a.b.c' },
  'room:mode_set': { mode: 'blitz' },
  'room:blitz_config': { hintTimerSec: 30, guessTimerSec: 30 },
  'team:set': { team: 'red' },
  'role:set': { role: 'operative', team: 'red' },
  'game:start': {},
  'game:rematch': { mode: 'same_teams' },
  'game:gg': {},
  'game:mvp_vote': { targetSessionId: 'x' },
  'turn:hint_submit': { word: 'zebra', count: 1 },
  'turn:mark_toggle': { index: 0 },
  'turn:mark_confidence': { index: 0, confidence: 'tentative' },
  'turn:guess': { index: 0 },
  'turn:end': {},
  'voice:join': {},
  'voice:credentials': {},
  'voice:leave': {},
  'voice:signal': { targetSessionId: 'x', type: 'offer', sdp: 'v=0' },
  'voice:speaking': { speaking: true },
  'voice:mute': { muted: true },
  'chat:send': { text: 'hi' },
  'no:such_event': {},
};
// These move the socket between rooms, so they run last.
const MOVING = { 'room:create': { name: 'Fz' }, 'room:join': { code: 'ZZZZ' }, 'room:rejoin': { code: 'ZZZZ', sessionId: 'x', reconnectToken: 'y' }, 'room:prune_disconnected': {}, 'room:leave': {} };

const deepArray = (n) => { let v = []; for (let i = 0; i < n; i += 1) v = [v]; return v; };
const deepObject = (n) => { let v = {}; for (let i = 0; i < n; i += 1) v = { a: v }; return v; };
const VALUES = [
  null, true, false, 0, -1, 1.5, 25, 24, 1e308, -1e308, '', ' ', '0', 'x'.repeat(70000), '\u0000‮​', '👨‍👩‍👧'.repeat(40),
  'red', 'none', 'spymaster', 'blitz', 'firm', 'offer', [], [1, 2], ['red'], {}, { toString: 1 }, { valueOf: 'x', length: 1e9 },
  JSON.parse('{"__proto__":{"polluted":1}}'), { constructor: { prototype: { polluted: 1 } } }, deepArray(400), deepObject(400),
];
const WHOLE = [null, undefined, 0, 1, 'str', true, [], [null], {}, deepArray(800), Object.fromEntries(Array.from({ length: 2000 }, (_, i) => ['k' + i, i]))];

test('protocol fuzz: hostile messages never crash, throw or corrupt a room', { timeout: 240_000 }, async () => {
  mkdirSync('data', { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), 'data/fuzz-'));
  const app = createApp({ restoreState: false, corsOrigin: '*', partySecret: secret, partyFile: join(dir, 'party.sqlite'), botDelayScale: 1000, socketFloodMax: 1e9 });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.httpServer.address().port;
  const sockets = [];
  const failures = [];
  const log = console.log;
  console.log = (line, ...rest) => {
    if (typeof line === 'string' && /"event":"(handler_failed|room_error|unhandled_rejection|action_failed)"/.test(line)) failures.push(line);
    else if (process.env.FUZZ_VERBOSE) log(line, ...rest);
  };
  const crashes = [];
  const onCrash = (error) => crashes.push(String(error?.stack || error));
  process.on('uncaughtException', onCrash); process.on('unhandledRejection', onCrash);
  const connect = async () => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(s); await new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); }); return s; };
  const ack = (s, event, payload, ms = 3000) => new Promise((resolve) => s.timeout(ms).emit(event, payload, (err, res) => resolve(err ? { timeout: true } : res)));
  const call = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + secret, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
  const resetLimits = () => { for (const s of app.io.sockets.sockets.values()) s.data.rateBuckets = {}; };
  let sent = 0;
  async function fuzz(socket, events) {
    for (const [event, valid] of Object.entries(events)) {
      const fields = [...new Set([...Object.keys(valid), 'code', 'sessionId', 'name', 'index', 'extra', '__proto__', 'constructor'])];
      const payloads = [...WHOLE];
      for (const field of fields) for (const value of VALUES) payloads.push({ ...valid, [field]: value });
      for (const [i, payload] of payloads.entries()) {
        resetLimits();
        if (i % 7 === 0) socket.emit(event, payload); // no ack function
        else if (i % 11 === 0) socket.emit(event, payload, 'not-a-callback', () => {});
        else { const res = await ack(socket, event, payload); assert.ok(res?.timeout || typeof res === 'object', `${event} answered`); }
        sent += 1;
      }
      // Only-a-callback and nothing at all.
      await ack(socket, event, undefined); socket.emit(event); sent += 2;
      await ack(socket, 'chat:send', { text: 'sync' });
    }
  }
  function assertRoomSane(room) {
    if (!room) return;
    for (const p of room.players.values()) {
      assert.equal(typeof p.name, 'string'); assert.ok(p.name.length > 0 && p.name.length <= 200, 'name stays bounded');
      assert.ok(['red', 'blue', 'none'].includes(p.team), `team ${p.team}`);
      assert.ok(['spymaster', 'operative', 'spectator'].includes(p.role), `role ${p.role}`);
    }
    const g = room.game; if (!g) return;
    assert.equal(g.board.length, 25);
    assert.ok(['hint', 'guess', 'finished'].includes(g.phase));
    for (const team of ['red', 'blue']) assert.ok(Number.isInteger(g.remaining[team]) && g.remaining[team] >= 0 && g.remaining[team] <= 9);
    if (g.hint) { assert.equal(typeof g.hint.word, 'string'); assert.ok(g.hint.word.length <= 64 && g.hint.word.trim()); assert.ok(Number.isInteger(g.hint.count)); }
    for (const msg of room.chatMessages) assert.ok(typeof msg.text === 'string' && msg.text.length <= 200);
  }
  try {
    assert.equal({}.polluted, undefined);
    // Phase 1: unbound socket.
    const loose = await connect();
    await fuzz(loose, EVENTS);
    // Phase 2: a normal room in the lobby, as host.
    const host = await connect(); const guest = await connect();
    const created = await ack(host, 'room:create', { name: 'Host' });
    await ack(guest, 'room:join', { code: created.roomCode, name: 'Guest' });
    const room = app.rooms.get(created.roomCode);
    await fuzz(host, EVENTS); assertRoomSane(room);
    // Phase 3: in a game, as each role, in each phase.
    if (room.game && room.game.phase !== 'finished') { room.game.phase = 'finished'; }
    resetLimits();
    await ack(host, 'role:set', { role: 'spymaster', team: 'red' }); await ack(guest, 'role:set', { role: 'operative', team: 'red' });
    await ack(host, 'room:mode_set', { mode: 'casual' });
    const restart = async () => { resetLimits(); if (room.game) room.game.phase = 'finished'; await ack(host, room.game ? 'game:rematch' : 'game:start', room.game ? { mode: 'same_teams' } : {}); room.game.currentTeam = 'red'; room.game.phase = 'hint'; };
    await restart(); await fuzz(host, EVENTS); assertRoomSane(room); // spymaster, hint phase
    await restart(); room.game.phase = 'guess'; room.game.hint = { word: 'X', count: 2, team: 'red' }; room.game.guessesRemaining = 3;
    await fuzz(guest, EVENTS); assertRoomSane(room); // operative, guess phase
    await restart(); room.game.phase = 'finished'; await fuzz(guest, EVENTS); assertRoomSane(room);
    // Phase 4: a party seat.
    const P = (n) => ({ id: randomUUID(), name: n, color: '#123456' }), B = (n) => ({ ...P(n), bot: true });
    const match = { id: randomUUID(), players: [P('Ada'), B('b'), B('c'), B('d')] };
    const partyCode = (await call('/_party/matches', match)).data.room;
    const seat = (await call(`/_party/matches/${match.id}/join`, { player: match.players[0].id })).data;
    const ada = await connect();
    assert.equal((await ack(ada, 'room:rejoin', { code: seat.room, sessionId: seat.sessionId, reconnectToken: seat.reconnectToken })).ok, true);
    const adaBound = () => app.io.sockets.sockets.get(ada.id)?.data.roomCode === partyCode;
    await fuzz(ada, EVENTS); assertRoomSane(app.rooms.get(partyCode));
    assert.ok(adaBound(), 'the party seat survives the fuzz');
    await fuzz(ada, MOVING); assertRoomSane(app.rooms.get(partyCode));
    // Phase 5: room-moving events from every socket.
    for (const s of [loose, guest, host]) await fuzz(s, MOVING);
    for (const r of app.rooms.values()) assertRoomSane(r);

    // Raw frames below Socket.IO: junk, broken JSON, binary, unknown packet types, oversize.
    const wsUrl = base.replace('http', 'ws') + '/socket.io/?EIO=4&transport=websocket';
    const raw = (frames) => new Promise((resolve) => {
      const ws = new WebSocket(wsUrl);
      ws.on('open', () => { ws.send('40'); for (const f of frames) ws.send(f); setTimeout(() => ws.close(), 150); });
      ws.on('close', resolve); ws.on('error', resolve);
    });
    await raw(['42[', '42["room:create",', '42[1,2,3]', '42["turn:guess",{"index":', '4' + '['.repeat(5000), '42' + JSON.stringify(['chat:send', deepObject(3000)]),
      '45-["x"]', '43', '41', '9999', '', '\u0000', Buffer.from([0, 1, 2, 255]), '42["__proto__",{}]', '42["constructor"]', '42["room:create",null]']);
    await raw(['42' + JSON.stringify(['chat:send', { text: 'x'.repeat(2_000_000) }])]); // > maxHttpBufferSize: closed
    await raw(Array.from({ length: 300 }, (_, i) => `42${i}["room:join",{"code":${i}}]`));

    // Bursts against the real flood guard (default cap) close only the flooding socket.
    const res = await fetch(base + '/api/health'); assert.equal(res.status, 200);
    assert.deepEqual(crashes, []);
    assert.deepEqual(failures, [], 'no handler threw');
    assert.equal({}.polluted, undefined, 'no prototype pollution');
    // A fresh room still plays.
    const a = await connect(); const b = await connect();
    const fresh = await ack(a, 'room:create', { name: 'A' }); await ack(b, 'room:join', { code: fresh.roomCode, name: 'B' });
    await ack(a, 'role:set', { role: 'spymaster', team: 'red' }); await ack(b, 'role:set', { role: 'operative', team: 'red' });
    assert.equal((await ack(a, 'game:start', {})).ok, true);
    const g = app.rooms.get(fresh.roomCode).game; g.currentTeam = 'red';
    assert.equal((await ack(a, 'turn:hint_submit', { word: 'zebra', count: 1 })).ok, true);
    assert.equal((await ack(b, 'turn:guess', { index: g.board.find((c) => c.color === 'red').index })).ok, true);
    assert.ok(sent > 10000, `sent ${sent} messages`);
  } finally {
    console.log = log;
    process.off('uncaughtException', onCrash); process.off('unhandledRejection', onCrash);
    sockets.forEach((s) => s.disconnect());
    await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval); app.party.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a flooding socket is closed while other players keep playing', async () => {
  const app = createApp({ restoreState: false, corsOrigin: '*' });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.httpServer.address().port;
  const log = console.log; const violations = [];
  console.log = (line) => { if (typeof line === 'string' && line.includes('"rule_violation"')) violations.push(line); };
  const connect = async () => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); await new Promise((r) => s.once('connect', r)); return s; };
  const ack = (s, event, payload) => new Promise((resolve) => s.timeout(3000).emit(event, payload, (err, res) => resolve(err ? { timeout: true } : res)));
  const a = await connect(), b = await connect();
  try {
    const room = await ack(a, 'room:create', { name: 'A' });
    await ack(b, 'room:join', { code: room.roomCode, name: 'B' });
    let errors = 0; b.on('error:rule_violation', () => { errors += 1; });
    for (let i = 0; i < 100; i += 1) b.emit('chat:send', { text: 'spam ' + i });
    await ack(a, 'chat:send', { text: 'still here' });
    await new Promise((r) => setTimeout(r, 100));
    assert.ok(errors <= 1, `one rate-limit warning per window, got ${errors}`);
    const closed = new Promise((r) => b.once('disconnect', r));
    for (let i = 0; i < 600; i += 1) b.emit('no:such_event', { i });
    await closed;
    assert.equal((await ack(a, 'chat:send', { text: 'after the flood' })).ok, true);
    assert.equal(app.rooms.get(room.roomCode).players.size, 2, 'the flooder keeps a seat it can resume');
    assert.ok(violations.length <= 2);
  } finally {
    console.log = log; a.disconnect(); b.disconnect();
    await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval);
  }
});

test('a room whose timer throws is isolated; other rooms keep their clocks', async () => {
  const app = createApp({ restoreState: false, corsOrigin: '*' });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.httpServer.address().port;
  const log = console.log; const errors = [];
  console.log = (line) => { if (typeof line === 'string' && line.includes('"room_error"')) errors.push(JSON.parse(line)); };
  const crashes = []; const onCrash = (e) => crashes.push(e); process.on('uncaughtException', onCrash);
  const connect = async () => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); await new Promise((r) => s.once('connect', r)); return s; };
  const ack = (s, event, payload) => new Promise((resolve) => s.timeout(3000).emit(event, payload, (err, res) => resolve(err ? { timeout: true } : res)));
  const clients = [];
  async function blitzRoom() {
    const s = await connect(); clients.push(s);
    const { roomCode } = await ack(s, 'room:create', { name: 'A' });
    await ack(s, 'role:set', { role: 'spymaster', team: 'red' });
    await ack(s, 'room:mode_set', { mode: 'blitz' });
    app.rooms.get(roomCode).blitzConfig = { hintTimerMs: 60, guessTimerMs: 60 };
    return roomCode;
  }
  try {
    const broken = await blitzRoom(), healthy = await blitzRoom();
    const brokenRoom = app.rooms.get(broken), healthyRoom = app.rooms.get(healthy);
    for (const [code, s] of [[broken, clients[0]], [healthy, clients[1]]]) assert.equal((await ack(s, 'game:start', {})).ok, true, code);
    brokenRoom.game.history = { push() { throw new Error('boom'); }, filter: () => [] };
    const turn = healthyRoom.game.turnNumber;
    await new Promise((r) => setTimeout(r, 400));
    assert.ok(healthyRoom.game.turnNumber >= turn + 2, 'the healthy room kept expiring its phases');
    assert.deepEqual(crashes, []);
    assert.equal(errors.filter((e) => e.roomCode === broken).length, 1, 'logged once per room');
    assert.equal(errors[0].kind, 'phase_timer');
  } finally {
    console.log = log; process.off('uncaughtException', onCrash); clients.forEach((c) => c.disconnect());
    for (const t of app.phaseTimers.values()) clearTimeout(t);
    await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval);
  }
});
