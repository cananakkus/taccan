const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs'); const { join } = require('node:path');
const { io } = require('socket.io-client'); const { createApp } = require('../backend/server');
const secret = 'private'.repeat(8);
const emit = (s, event, data) => new Promise((resolve, reject) => { s.timeout(3000).emit(event, data, (error, response) => error ? reject(error) : resolve(response)); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test('Murmur party bots take seats, play both roles, survive restarts and never stall', async () => {
  mkdirSync('data', { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), 'data/party-bots-')), file = join(dir, 'party.sqlite');
  let app, base; const sockets = [];
  async function boot() { app = createApp({ restoreState: false, corsOrigin: '*', partySecret: secret, partyFile: file, botDelayScale: 0.01 }); await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + app.httpServer.address().port; }
  async function stop() { sockets.splice(0).forEach((s) => s.disconnect()); await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval); app.party.close(); }
  async function call(path, body) { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + secret, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; }
  // A human who passes whenever it is their turn to guess.
  async function human(match, member) {
    const seat = (await call(`/_party/matches/${match.id}/join`, { player: member.id })).data;
    const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(s);
    s.on('state:full', (state) => { s.snapshot = state; const g = state.game; if (s.passes && g?.phase === 'guess' && g.currentTeam === state.me.team && state.me.role === 'operative') s.emit('turn:end', {}, () => {}); });
    await new Promise((r, j) => { s.once('connect', r); s.once('connect_error', j); });
    assert.equal((await emit(s, 'room:rejoin', { code: seat.room, sessionId: seat.sessionId, reconnectToken: seat.reconnectToken, name: member.name })).ok, true);
    return s;
  }
  async function result(match, ms = 15000) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(25)) { const r = (await call(`/_party/matches/${match.id}`)).data; if (r.result) return r.result; }
    throw Error('match did not finish');
  }
  const person = (name) => ({ id: randomUUID(), name, color: '#13acbc' });
  const bot = (name, skill) => ({ id: randomUUID(), name, color: '#ffd166', bot: true, ...(skill ? { skill } : {}) });
  await boot();
  try {
    // Validation.
    const bad = (players) => call('/_party/matches', { id: randomUUID(), players });
    assert.equal((await bad([person('A'), bot('B'), bot('C'), { ...bot('D'), bot: 'yes' }])).status, 400);
    assert.equal((await bad([person('A'), bot('B'), bot('C'), bot('D', 'expert')])).status, 400);
    assert.equal((await bad([person('A'), bot('B'), bot('C'), bot('A very long bot name')])).status, 400);
    assert.equal((await bad([bot('A'), bot('B'), bot('C'), bot('D')])).data.error, 'A match needs at least one human');

    // 1 human operative + 5 bots: bots give clues, guess, and defer to (then cover for) the idle human.
    const six = { id: randomUUID(), players: [bot('Rusty', 'hard'), bot('Pip', 'easy'), person('Ada'), bot('Bolt'), bot('Cog', 'normal'), bot('Nib', 'hard')] };
    const sixCode = (await call('/_party/matches', six)).data.room;
    const before = (await call(`/_party/matches/${six.id}`)).data;
    assert.deepEqual(new Set(before.connected), new Set(six.players.filter((p) => p.bot).map((p) => p.id)));
    const joinBot = await call(`/_party/matches/${six.id}/join`, { player: six.players[0].id });
    assert.deepEqual([joinBot.status, joinBot.data.error], [400, 'Bots cannot be joined']);
    const room = app.rooms.get(sixCode);
    const botPlayer = room.players.get(six.players[0].id);
    assert.equal(botPlayer.bot, true); assert.equal(botPlayer.skill, 'hard'); assert.equal(room.players.get(six.players[3].id).skill, 'normal');
    assert.equal(room.game, null, 'the round waits for the human');
    const ada = await human(six, six.players[2]);
    const intruder = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(intruder);
    await new Promise((r) => intruder.once('connect', r));
    assert.equal((await emit(intruder, 'room:rejoin', { code: sixCode, sessionId: botPlayer.sessionId, reconnectToken: botPlayer.reconnectToken })).error, 'Bots cannot be joined.');
    await sleep(30);
    assert.ok(ada.snapshot.players.filter((p) => p.bot).length === 5 && !ada.snapshot.players.find((p) => p.sessionId === six.players[2].id).bot);
    assert.ok((await call(`/_party/matches/${six.id}`)).data.connected.length === 6);
    const sixResult = await result(six);
    assert.equal(sixResult.reason, 'played'); assert.equal(sixResult.draw, false);
    const history = app.rooms.get(sixCode).game.history, bots = new Set(six.players.filter((p) => p.bot).map((p) => p.id));
    assert.ok(history.some((e) => e.type === 'hint' && e.team === 'red' && bots.has(e.by)) && history.some((e) => e.type === 'hint' && e.team === 'blue' && bots.has(e.by)));
    assert.ok(history.some((e) => e.type === 'guess' && bots.has(e.by)));
    assert.ok(history.some((e) => e.type === 'mark_toggle' && e.by === six.players[4].id), 'the red bot suggests a card to its human teammate');
    assert.ok(sixResult.winners.every((id) => app.rooms.get(sixCode).players.get(id).team === app.rooms.get(sixCode).game.winner));

    // Restart mid-match: bots come back connected and keep playing.
    const four = { id: randomUUID(), players: [bot('Rusty'), bot('Pip'), person('Ada'), bot('Bolt')] };
    const fourCode = (await call('/_party/matches', four)).data.room;
    const ada4 = await human(four, four.players[2]); ada4.passes = true;
    for (let i = 0; i < 100 && app.rooms.get(fourCode).game.history.filter((e) => e.type === 'hint').length < 2; i += 1) await sleep(20);
    assert.equal((await call(`/_party/matches/${four.id}`)).data.result, null);
    await stop(); await boot();
    const restored = app.rooms.get(fourCode);
    assert.equal(restored.players.get(four.players[0].id).bot, true);
    assert.deepEqual(new Set((await call(`/_party/matches/${four.id}`)).data.connected), new Set([0, 1, 3].map((i) => four.players[i].id)));
    const back = await human(four, four.players[2]); back.passes = true;
    if (back.snapshot?.game?.phase === 'guess' && back.snapshot.game.currentTeam === 'red') back.emit('turn:end', {}, () => {});
    const fourResult = await result(four);
    assert.equal(fourResult.reason, 'played');
    assert.ok(app.rooms.get(fourCode).game.history.filter((e) => e.type === 'hint').length > 2);

    // The only human forfeits in a 4-seat match: their team is short, the bots win at once.
    const solo = { id: randomUUID(), players: [person('Ada'), bot('Pip'), bot('Rusty'), bot('Bolt')] };
    await call('/_party/matches', solo); await human(solo, solo.players[0]);
    const soloForfeit = (await call(`/_party/matches/${solo.id}/forfeit`, { player: solo.players[0].id })).data;
    assert.equal(soloForfeit.result.reason, 'forfeit'); assert.deepEqual(new Set(soloForfeit.result.winners), new Set([solo.players[1].id, solo.players[3].id]));

    // The only human forfeits with bots left on both teams: the bots finish the round immediately.
    const crowd = { id: randomUUID(), players: [bot('A'), bot('B'), person('Ada'), bot('C'), bot('D'), bot('E')] };
    const crowdCode = (await call('/_party/matches', crowd)).data.room;
    const crowdForfeit = (await call(`/_party/matches/${crowd.id}/forfeit`, { player: crowd.players[2].id })).data;
    assert.ok(crowdForfeit.result, 'result is immediate');
    assert.equal(app.rooms.get(crowdCode).game.phase, 'finished');
    assert.ok(crowdForfeit.result.winners.every((id) => id !== crowd.players[2].id));
    await stop(); await boot();
    assert.deepEqual((await call(`/_party/matches/${crowd.id}`)).data.result, crowdForfeit.result);
  } finally { await stop(); rmSync(dir, { recursive: true, force: true }); }
});
