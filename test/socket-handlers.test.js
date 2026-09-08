const test = require('node:test');
const assert = require('node:assert/strict');
const { io: ioClient } = require('socket.io-client');
const { createApp } = require('../backend/server');

function boot() {
  const ctx = createApp({ corsOrigin: '*' });
  return new Promise((resolve) => {
    ctx.httpServer.listen(0, '127.0.0.1', () => {
      const port = ctx.httpServer.address().port;
      resolve({ ...ctx, port });
    });
  });
}

function connect(port) {
  return ioClient(`http://127.0.0.1:${port}`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
  });
}

function emit(client, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 5000);
    client.emit(event, payload, (res) => {
      clearTimeout(timer);
      resolve(res);
    });
  });
}

function waitFor(client, event, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Waiting for ${event} timed out`)), ms);
    client.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

/** Set up listener BEFORE triggering the action, to avoid missing synchronous events */
function collectNext(client, event) {
  return new Promise((resolve) => {
    client.once(event, resolve);
  });
}

function shutdown(ctx, ...clients) {
  for (const c of clients) c.disconnect();
  clearInterval(ctx.cleanupInterval);
  ctx.io.close();
  return new Promise((resolve) => ctx.httpServer.close(resolve));
}

async function setupRoom(ctx) {
  const spy = connect(ctx.port);
  const op = connect(ctx.port);
  await waitFor(spy, 'server:ready');
  await waitFor(op, 'server:ready');

  const create = await emit(spy, 'room:create', { name: 'Spy' });
  const stateP = collectNext(op, 'state:full');
  await emit(op, 'room:join', { code: create.roomCode, name: 'Op' });
  await stateP;

  return { spy, op, roomCode: create.roomCode, hostSessionId: create.sessionId };
}

/** Wait for a state:full that satisfies a predicate, ignoring intermediate ones */
function waitForState(client, predicate, ms = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('state:full', handler);
      reject(new Error('waitForState timed out'));
    }, ms);
    const handler = (data) => {
      if (predicate(data)) {
        client.off('state:full', handler);
        clearTimeout(timer);
        resolve(data);
      }
    };
    client.on('state:full', handler);
  });
}

async function setupGame(ctx) {
  const { spy, op, roomCode, hostSessionId } = await setupRoom(ctx);

  await emit(spy, 'team:set', { team: 'red' });
  await emit(spy, 'role:set', { role: 'spymaster' });
  await emit(op, 'team:set', { team: 'red' });
  await emit(op, 'role:set', { role: 'operative' });

  // Listen for a state:full that has game data (ignoring stale team/role updates)
  const gameStateP = waitForState(spy, (s) => s.game !== null);
  await emit(spy, 'game:start', {});
  let spyState = await gameStateP;

  // Align teams to starting team
  const team = spyState.game.currentTeam;
  if (team !== 'red') {
    const alignedP = waitForState(spy, (s) => s.game !== null);
    await emit(spy, 'team:set', { team });
    await emit(spy, 'role:set', { role: 'spymaster' });
    await emit(op, 'team:set', { team });
    await emit(op, 'role:set', { role: 'operative' });
    spyState = await alignedP;
  }

  return { spy, op, roomCode, hostSessionId, spyState };
}

// --- Tests ---

test('room:create returns code and sessionId', async () => {
  const ctx = await boot();
  const c1 = connect(ctx.port);
  try {
    await waitFor(c1, 'server:ready');
    const res = await emit(c1, 'room:create', { name: 'Host' });
    assert.equal(res.ok, true);
    assert.equal(typeof res.roomCode, 'string');
    assert.equal(res.roomCode.length, 4);
    assert.equal(typeof res.sessionId, 'string');
  } finally {
    await shutdown(ctx, c1);
  }
});

test('room:join succeeds with valid code', async () => {
  const ctx = await boot();
  const c1 = connect(ctx.port);
  const c2 = connect(ctx.port);
  try {
    await waitFor(c1, 'server:ready');
    await waitFor(c2, 'server:ready');
    const create = await emit(c1, 'room:create', { name: 'Host' });
    const join = await emit(c2, 'room:join', { code: create.roomCode, name: 'Guest' });
    assert.equal(join.ok, true);
    assert.equal(join.roomCode, create.roomCode);
  } finally {
    await shutdown(ctx, c1, c2);
  }
});

test('room:join fails with invalid code', async () => {
  const ctx = await boot();
  const c1 = connect(ctx.port);
  try {
    await waitFor(c1, 'server:ready');
    const res = await emit(c1, 'room:join', { code: 'ZZZZ', name: 'Test' });
    assert.equal(res.ok, false);
    assert.match(res.error, /not found/i);
  } finally {
    await shutdown(ctx, c1);
  }
});

test('room:rejoin restores session', async () => {
  const ctx = await boot();
  const c1 = connect(ctx.port);
  try {
    await waitFor(c1, 'server:ready');
    const create = await emit(c1, 'room:create', { name: 'Host' });
    c1.disconnect();

    const c2 = connect(ctx.port);
    await waitFor(c2, 'server:ready');
    const rejoin = await emit(c2, 'room:rejoin', {
      code: create.roomCode,
      sessionId: create.sessionId,
      name: 'Host',
    });
    assert.equal(rejoin.ok, true);
    assert.equal(rejoin.sessionId, create.sessionId);
    c2.disconnect();
  } finally {
    await shutdown(ctx, c1);
  }
});

test('non-host cannot start game', async () => {
  const ctx = await boot();
  const { spy, op } = await setupRoom(ctx);
  try {
    const res = await emit(op, 'game:start', {});
    assert.equal(res.ok, false);
    assert.match(res.error, /host/i);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('non-host cannot change mode', async () => {
  const ctx = await boot();
  const { spy, op } = await setupRoom(ctx);
  try {
    const res = await emit(op, 'room:mode_set', { mode: 'blitz' });
    assert.equal(res.ok, false);
    assert.match(res.error, /host/i);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('full game flow: hint, guess, turn advance', async () => {
  const ctx = await boot();
  const { spy, op, spyState } = await setupGame(ctx);
  try {
    // Spymaster submits hint
    const hintRes = await emit(spy, 'turn:hint_submit', { word: 'clue', count: 1 });
    assert.equal(hintRes.ok, true);
    assert.equal(hintRes.accepted, true);

    // Wait for op to get guess phase state
    const opState = await waitFor(op, 'state:full');
    assert.equal(opState.game.phase, 'guess');

    // Operative guesses first unrevealed card
    const firstCard = opState.game.board.find((c) => !c.revealed);
    const guessRes = await emit(op, 'turn:guess', { index: firstCard.index });
    assert.equal(guessRes.ok, true);
    assert.ok(guessRes.color);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('assassin card ends game', async () => {
  const ctx = await boot();
  const { spy, op, spyState } = await setupGame(ctx);
  try {
    const assassin = spyState.game.board.find((c) => c.color === 'assassin');
    assert.ok(assassin, 'Should have assassin card in spymaster view');

    await emit(spy, 'turn:hint_submit', { word: 'trap', count: 1 });
    await waitFor(op, 'state:full');

    const guessRes = await emit(op, 'turn:guess', { index: assassin.index });
    assert.equal(guessRes.ok, true);
    assert.equal(guessRes.color, 'assassin');
    assert.equal(guessRes.finished, true);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('multi-word hint accepted', async () => {
  const ctx = await boot();
  const { spy, op } = await setupGame(ctx);
  try {
    const res = await emit(spy, 'turn:hint_submit', { word: 'two words', count: 1 });
    assert.ok(res.ok !== false, 'multi-word hints should be accepted');
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('mark toggle during wrong phase rejected', async () => {
  const ctx = await boot();
  const { spy, op } = await setupGame(ctx);
  try {
    // During hint phase, mark toggle should fail
    const res = await emit(op, 'turn:mark_toggle', { index: 0 });
    assert.equal(res.ok, false);
    assert.match(res.error, /guess phase/i);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('confidence resets to firm after a turn boundary', async () => {
  const ctx = await boot();
  const { spy, op, spyState } = await setupGame(ctx);
  try {
    const startingTeam = spyState.game.currentTeam;
    const opposingTeam = startingTeam === 'red' ? 'blue' : 'red';

    const neutral = spyState.game.board.find((c) => c.color === 'neutral');
    assert.ok(neutral, 'board should include a neutral card');
    const markIndex = spyState.game.board.findIndex((c) => !c.revealed && c.index !== neutral.index);
    assert.ok(markIndex >= 0, 'should find a second unrevealed card to mark');

    await emit(spy, 'turn:hint_submit', { word: 'onewordhint', count: 1 });

    const firstMarkP = waitFor(op, 'turn:mark_update');
    await emit(op, 'turn:mark_toggle', { index: markIndex });
    const firstMark = await firstMarkP;
    assert.equal(firstMark.marks.length, 1);
    assert.equal(firstMark.marks[0].confidence, 'firm');

    const confidenceMarkP = waitFor(op, 'turn:mark_update');
    await emit(op, 'turn:mark_confidence', { index: markIndex, confidence: 'tentative' });
    const confidenceMark = await confidenceMarkP;
    assert.equal(confidenceMark.marks[0].confidence, 'tentative');

    const turnAdvancedP = waitForState(op, (s) => s.game?.currentTeam === opposingTeam && s.game?.phase === 'hint');
    await emit(op, 'turn:guess', { index: neutral.index });
    await turnAdvancedP;

    await emit(spy, 'team:set', { team: opposingTeam });
    await emit(spy, 'role:set', { role: 'spymaster' });
    await emit(op, 'team:set', { team: opposingTeam });
    await emit(op, 'role:set', { role: 'operative' });

    await emit(spy, 'turn:hint_submit', { word: 'twowordhint', count: 1 });

    const remarkP = waitFor(op, 'turn:mark_update');
    await emit(op, 'turn:mark_toggle', { index: markIndex });
    const remark = await remarkP;
    assert.equal(remark.marks.length, 1, 'the card should have exactly one marker after re-marking');
    assert.equal(remark.marks[0].confidence, 'firm', 'confidence should default to firm, not carry over from previous turn');
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('rate limiting triggers on burst', async () => {
  const ctx = await boot();
  const c1 = connect(ctx.port);
  try {
    await waitFor(c1, 'server:ready');

    const results = [];
    for (let i = 0; i < 12; i++) {
      results.push(await emit(c1, 'room:create', { name: `P${i}` }));
    }

    const rejected = results.filter((r) => !r.ok);
    assert.ok(rejected.length > 0, 'Expected some requests to be rate limited');
    assert.match(rejected[0].error, /too many/i);
  } finally {
    await shutdown(ctx, c1);
  }
});

test('rematch preserves matchId and increments roundNumber', async () => {
  const ctx = await boot();
  const { spy, op, spyState } = await setupGame(ctx);
  try {
    const assassin = spyState.game.board.find((c) => c.color === 'assassin');

    // Set up listener for guess phase BEFORE submitting hint
    const guessPhaseP = waitForState(op, (s) => s.game?.phase === 'guess');
    await emit(spy, 'turn:hint_submit', { word: 'end', count: 1 });
    await guessPhaseP;

    // Set up listener for finished state BEFORE guessing assassin
    const finishedP = waitForState(spy, (s) => s.game?.phase === 'finished');
    await emit(op, 'turn:guess', { index: assassin.index });
    const finished = await finishedP;

    const matchId1 = finished.game.matchId;
    const round1 = finished.game.roundNumber;

    const rematch = await emit(spy, 'game:rematch', { mode: 'same_teams' });
    assert.equal(rematch.ok, true);
    assert.equal(rematch.matchId, matchId1);
    assert.equal(rematch.roundNumber, round1 + 1);
  } finally {
    await shutdown(ctx, spy, op);
  }
});


test('rejoining on the same socket preserves a one-player room', async () => {
  const ctx = await boot();
  const client = connect(ctx.port);
  try {
    await waitFor(client, 'server:ready');
    const created = await emit(client, 'room:create', { name: 'Host' });
    await emit(client, 'team:set', { team: 'red' });
    await emit(client, 'game:start', {});
    const room = ctx.rooms.get(created.roomCode);
    const game = room.game;
    const result = await emit(client, 'room:rejoin', {
      code: created.roomCode, sessionId: created.sessionId,
    });
    assert.equal(result.ok, true);
    assert.equal(ctx.rooms.get(created.roomCode), room);
    assert.equal(room.game, game);
    assert.equal((await emit(client, 'team:set', { team: 'blue' })).ok, true);
  } finally {
    await shutdown(ctx, client);
  }
});

test('active operative snapshots hide the seed; finished snapshots disclose it', async () => {
  const ctx = await boot();
  const { spy, op, roomCode } = await setupGame(ctx);
  try {
    const stateP = waitForState(op, (s) => s.game?.phase === 'guess');
    await emit(spy, 'turn:hint_submit', { word: 'secret', count: 1 });
    const state = await stateP;
    assert.equal(state.game.seed, null);
    assert.ok(state.game.board.every((card) => card.color === null));
    const room = ctx.rooms.get(roomCode);
    const finishedP = waitForState(op, (s) => s.game?.phase === 'finished');
    const assassin = room.game.board.find((card) => card.color === 'assassin');
    await emit(op, 'turn:guess', { index: assassin.index });
    assert.equal((await finishedP).game.seed, room.game.seed);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

for (const transport of ['polling', 'websocket']) {
  test(`subpath supports API and Socket.IO ${transport}`, async () => {
    const ctx = await boot();
    const client = ioClient(`http://127.0.0.1:${ctx.port}`, {
      path: '/taccan/socket.io', transports: [transport],
      forceNew: true, reconnection: false,
    });
    try {
      await waitFor(client, 'server:ready');
      assert.equal((await emit(client, 'room:create', {})).ok, true);
      const response = await fetch(`http://127.0.0.1:${ctx.port}/taccan/api/turn-credentials`);
      assert.equal(response.status, 200);
      assert.ok(Array.isArray((await response.json()).iceServers));
    } finally {
      await shutdown(ctx, client);
    }
  });
}

test('rejoining a restored blitz game resumes its timer only once', async () => {
  const ctx = await boot();
  const client = connect(ctx.port);
  try {
    await waitFor(client, 'server:ready');
    const created = await emit(client, 'room:create', {});
    await emit(client, 'team:set', { team: 'red' });
    await emit(client, 'room:mode_set', { mode: 'blitz' });
    await emit(client, 'game:start', {});
    const room = ctx.rooms.get(created.roomCode);
    // Persistence clears the deadline and cannot restore a JS timeout handle.
    clearTimeout(ctx.phaseTimers.get(room.code));
    ctx.phaseTimers.delete(room.code);
    room.game.phaseTimer = null;
    const payload = { code: room.code, sessionId: created.sessionId };
    assert.equal((await emit(client, 'room:rejoin', payload)).ok, true);
    assert.ok(ctx.phaseTimers.has(room.code));
    const timer = room.game.phaseTimer;
    assert.ok(timer);
    assert.equal((await emit(client, 'room:rejoin', payload)).ok, true);
    assert.equal(room.game.phaseTimer, timer);
  } finally {
    for (const timer of ctx.phaseTimers.values()) clearTimeout(timer);
    await shutdown(ctx, client);
  }
});

test('voice joins notify once and signals stop after a peer leaves', async () => {
  const ctx = await boot();
  const { spy, op } = await setupRoom(ctx);
  try {
    assert.deepEqual((await emit(spy, 'voice:join', {})).peers, []);
    let notifications = 0;
    spy.on('voice:peer_joined', () => notifications++);
    const joinedP = waitFor(spy, 'voice:peer_joined');
    const joined = await emit(op, 'voice:join', {});
    const peer = await joinedP;
    assert.equal(joined.peers.length, 1);
    await emit(op, 'voice:join', {});
    // The ack on this same socket confirms prior notifications were delivered.
    await emit(spy, 'voice:join', {});
    assert.equal(notifications, 1);
    const signalP = waitFor(op, 'voice:signal');
    const signal = { targetSessionId: peer.sessionId, type: 'offer', sdp: 'test-offer' };
    assert.equal((await emit(spy, 'voice:signal', signal)).ok, true);
    assert.equal((await signalP).sdp, 'test-offer');
    const leftP = waitFor(spy, 'voice:peer_left');
    await emit(op, 'voice:leave', {});
    await leftP;
    assert.equal((await emit(spy, 'voice:signal', signal)).ok, false);
  } finally {
    await shutdown(ctx, spy, op);
  }
});

test('spymaster positions reject competing claims atomically and cannot be stolen through team changes', async () => {
  const ctx = await boot();
  const { spy, op, roomCode } = await setupRoom(ctx);
  try {
    const room = ctx.rooms.get(roomCode);
    const before = [...room.players.values()].map(p => ({ id: p.sessionId, team: p.team, role: p.role }));
    const results = await Promise.all([spy, op].map(client => emit(client, 'role:set', { role: 'spymaster', team: 'red' })));
    assert.equal(results.filter(result => result.ok).length, 1);
    assert.equal([...room.players.values()].filter(p => p.team === 'red' && p.role === 'spymaster').length, 1);
    const loser = results[0].ok ? op : spy;
    const winner = results[0].ok ? spy : op;
    const unclaimed = [...room.players.values()].find(p => p.team !== 'red' || p.role !== 'spymaster');
    const original = before.find(p => p.id === unclaimed.sessionId);
    assert.equal(unclaimed.team, original.team);
    assert.equal(unclaimed.role, original.role);
    assert.equal((await emit(loser, 'role:set', { role: 'spymaster', team: 'blue' })).ok, true);
    assert.equal((await emit(winner, 'team:set', { team: 'blue' })).ok, false);
    assert.equal((await emit(winner, 'role:set', { role: 'operative', team: 'blue' })).ok, true);
    assert.equal([...room.players.values()].filter(p => p.team === 'blue' && p.role === 'spymaster').length, 1);
    assert.equal((await emit(loser, 'role:set', { role: 'spymaster', team: 'red' })).ok, true);
  } finally { await shutdown(ctx, spy, op); }
});
