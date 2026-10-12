const test = require('node:test'), assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs'); const { join } = require('node:path');
const { io } = require('socket.io-client'); const { createApp } = require('../backend/server');
const secret = 'forfeits'.repeat(5);

// Play party contract: when every human forfeits, the best-placed bot (team)
// wins; an exact tie is { winners: [], draw: true }. All remaining bots must
// never be listed as co-winners.
test('when every human forfeits, the team ahead wins and an exact tie is a draw', async () => {
  mkdirSync('data', { recursive: true });
  const dir = mkdtempSync(join(process.cwd(), 'data/party-forfeit-'));
  const app = createApp({ restoreState: false, corsOrigin: '*', partySecret: secret, partyFile: join(dir, 'party.sqlite'), botDelayScale: 1000 });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.httpServer.address().port;
  const sockets = [];
  const call = async (path, body) => { const r = await fetch(base + path, { method: body ? 'POST' : 'GET', headers: { Authorization: 'Bearer ' + secret, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, data: await r.json() }; };
  const person = (name) => ({ id: randomUUID(), name, color: '#13acbc' });
  const bot = (name) => ({ id: randomUUID(), name, color: '#ffd166', bot: true, skill: 'normal' });
  // Seats alternate red/blue: 0 red, 1 blue, 2 red, 3 blue, 4 red, 5 blue.
  const lineup = () => ({ id: randomUUID(), players: [bot('R1'), bot('B1'), person('Ada'), person('Bo'), bot('R2'), bot('B2')] });
  async function seat(match, member) {
    const s = (await call(`/_party/matches/${match.id}/join`, { player: member.id })).data;
    const socket = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); sockets.push(socket);
    await new Promise((r) => socket.once('connect', r));
    await new Promise((r) => socket.emit('room:rejoin', { code: s.room, sessionId: s.sessionId, reconnectToken: s.reconnectToken }, r));
  }
  const forfeitAll = async (match, ...members) => { let last; for (const m of members) last = (await call(`/_party/matches/${match.id}/forfeit`, { player: m.id })).data; return last.result; };
  const ids = (match, ...indexes) => new Set(indexes.map((i) => match.players[i].id));
  try {
    // Before the deal nobody is ahead: a draw, not four co-winning bots.
    const early = lineup(); await call('/_party/matches', early);
    const earlyResult = await forfeitAll(early, early.players[2], early.players[3]);
    assert.deepEqual(earlyResult, { winners: [], draw: true, reason: 'forfeit' });

    // Dealt but untouched: the starting team holds 9 agents and the other 8.
    // That is not a lead: still a draw.
    const fresh = lineup(); const freshCode = (await call('/_party/matches', fresh)).data.room;
    await seat(fresh, fresh.players[2]); await seat(fresh, fresh.players[3]);
    assert.ok(app.rooms.get(freshCode).game, 'the round started');
    assert.deepEqual(await forfeitAll(fresh, fresh.players[2], fresh.players[3]), { winners: [], draw: true, reason: 'forfeit' });

    // The team with more of its agents found wins; only its bots are winners.
    for (const leader of ['red', 'blue']) {
      const match = lineup(); const code = (await call('/_party/matches', match)).data.room;
      await seat(match, match.players[2]); await seat(match, match.players[3]);
      const game = app.rooms.get(code).game;
      const total = (team) => (game.startingTeam === team ? 9 : 8);
      game.remaining = { red: total('red') - (leader === 'red' ? 3 : 1), blue: total('blue') - (leader === 'blue' ? 3 : 1) };
      const result = await forfeitAll(match, match.players[2], match.players[3]);
      assert.equal(result.draw, false); assert.equal(result.reason, 'forfeit');
      assert.deepEqual(new Set(result.winners), leader === 'red' ? ids(match, 0, 4) : ids(match, 1, 5));
      assert.equal(app.rooms.get(code).game.winner, leader);
    }

    // An exact tie in agents found mid-round is a draw.
    const tied = lineup(); const tiedCode = (await call('/_party/matches', tied)).data.room;
    await seat(tied, tied.players[2]); await seat(tied, tied.players[3]);
    const tiedGame = app.rooms.get(tiedCode).game;
    tiedGame.remaining = { red: (tiedGame.startingTeam === 'red' ? 9 : 8) - 2, blue: (tiedGame.startingTeam === 'blue' ? 9 : 8) - 2 };
    const tiedResult = await forfeitAll(tied, tied.players[3], tied.players[2]);
    assert.deepEqual(tiedResult, { winners: [], draw: true, reason: 'forfeit' });
    assert.equal(app.rooms.get(tiedCode).game.phase, 'finished');

    // One human left keeps the round alive.
    const partial = lineup(); await call('/_party/matches', partial);
    assert.equal(await forfeitAll(partial, partial.players[2]), null);
    // A team left with one player still loses at once (4 seats, the human's team is short).
    const short = { id: randomUUID(), players: [person('Ada'), bot('B1'), bot('R2'), bot('B2')] };
    await call('/_party/matches', short);
    const shortResult = await forfeitAll(short, short.players[0]);
    assert.deepEqual(new Set(shortResult.winners), ids(short, 1, 3));
    assert.equal(shortResult.draw, false);
  } finally {
    sockets.forEach((s) => s.disconnect());
    await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval); app.party.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
