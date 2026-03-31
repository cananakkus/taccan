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
