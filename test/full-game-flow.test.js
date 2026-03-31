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

function shutdown(ctx, ...clients) {
  for (const c of clients) c.disconnect();
  clearInterval(ctx.cleanupInterval);
  ctx.io.close();
  return new Promise((resolve) => ctx.httpServer.close(resolve));
}

async function setupGameWithBothTeams(ctx) {
  const spy = connect(ctx.port);
  const op = connect(ctx.port);
  await waitFor(spy, 'server:ready');
  await waitFor(op, 'server:ready');

  const create = await emit(spy, 'room:create', { name: 'Spy' });
  await emit(op, 'room:join', { code: create.roomCode, name: 'Op' });

  await emit(spy, 'team:set', { team: 'red' });
  await emit(spy, 'role:set', { role: 'spymaster' });
  await emit(op, 'team:set', { team: 'red' });
  await emit(op, 'role:set', { role: 'operative' });

  const gameStateP = waitForState(spy, (s) => s.game !== null);
  await emit(spy, 'game:start', {});
  let spyState = await gameStateP;

  // Align to starting team
  const team = spyState.game.currentTeam;
  if (team !== 'red') {
    const alignedP = waitForState(spy, (s) => s.game !== null);
    await emit(spy, 'team:set', { team });
    await emit(spy, 'role:set', { role: 'spymaster' });
    await emit(op, 'team:set', { team });
    await emit(op, 'role:set', { role: 'operative' });
    spyState = await alignedP;
  }

  return { spy, op, roomCode: create.roomCode, spyState, team: spyState.game.currentTeam };
}

test('full game: play to assassin finish, then rematch', async () => {
  const ctx = await boot();
  try {
    const { spy, op, roomCode, spyState, team } = await setupGameWithBothTeams(ctx);

    // Find the assassin card index from spymaster view
    const assassinCard = spyState.game.board.find(c => c.color === 'assassin');
    assert.ok(assassinCard, 'should have an assassin card');

    // Submit a hint
    const hintRes = await emit(spy, 'turn:hint_submit', { word: 'clue', count: 1 });
    assert.ok(hintRes.ok || hintRes.accepted, 'hint should be accepted');

    // Guess the assassin to end the game
    const finishedP = waitForState(op, (s) => s.game?.phase === 'finished');
    const guessRes = await emit(op, 'turn:guess', { index: assassinCard.index });
    assert.ok(guessRes.ok !== false, 'guess should succeed');

    const finishedState = await finishedP;
    assert.equal(finishedState.game.phase, 'finished');
    assert.ok(finishedState.game.winner, 'should have a winner');
    assert.equal(finishedState.game.reason, 'assassin');

    // Rematch
    const rematchP = waitForState(spy, (s) => s.game?.phase === 'hint' && s.game?.roundNumber === 2);
    const rematchRes = await emit(spy, 'game:rematch', { mode: 'same_teams' });
    assert.ok(rematchRes.ok !== false, 'rematch should succeed');

    const rematchState = await rematchP;
    assert.equal(rematchState.game.roundNumber, 2);
    assert.equal(rematchState.game.phase, 'hint');

    await shutdown(ctx, spy, op);
  } catch (err) {
    await shutdown(ctx);
    throw err;
  }
});

test('swap_teams rematch swaps player teams', async () => {
  const ctx = await boot();
  try {
    const { spy, op, spyState, team } = await setupGameWithBothTeams(ctx);

    // End game via assassin — set up listeners before action
    const assassinCard = spyState.game.board.find(c => c.color === 'assassin');
    await emit(spy, 'turn:hint_submit', { word: 'trap', count: 1 });
    const spyFinishedP = waitForState(spy, (s) => s.game?.phase === 'finished');
    const opFinishedP = waitForState(op, (s) => s.game?.phase === 'finished');
    await emit(op, 'turn:guess', { index: assassinCard.index });
    const preSwap = await spyFinishedP;
    await opFinishedP;

    const myTeamBefore = preSwap.me.team;

    // Swap rematch
    const swapP = waitForState(spy, (s) => s.game?.phase === 'hint' && s.game?.roundNumber === 2);
    await emit(spy, 'game:rematch', { mode: 'swap_teams' });
    const swapState = await swapP;

    const myTeamAfter = swapState.me.team;
    assert.notEqual(myTeamAfter, myTeamBefore, 'team should be swapped after swap_teams rematch');

    await shutdown(ctx, spy, op);
  } catch (err) {
    await shutdown(ctx);
    throw err;
  }
});
