const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getConnectedPlayerCount,
  ensureHostSession,
  getRoomReadinessError,
  pruneDisconnectedPlayers,
} = require('../backend/room-utils');

test('ensureHostSession reassigns host when current host is disconnected', () => {
  const now = Date.now();
  const host = {
    sessionId: 'host',
    name: 'Host',
    connected: false,
    joinedAt: now - 3,
    lastSeenAt: now - 1000,
  };
  const other = {
    sessionId: 'player2',
    name: 'Player 2',
    connected: true,
    joinedAt: now - 2,
    lastSeenAt: now,
  };
  const room = {
    hostSessionId: host.sessionId,
    players: new Map([
      [host.sessionId, host],
      [other.sessionId, other],
    ]),
  };

  ensureHostSession(room);
  assert.equal(room.hostSessionId, other.sessionId);
});

test('ensureHostSession keeps current host when host is connected', () => {
  const now = Date.now();
  const host = {
    sessionId: 'host',
    name: 'Host',
    connected: true,
    joinedAt: now - 3,
    lastSeenAt: now,
  };
  const olderConnected = {
    sessionId: 'older',
    name: 'Older',
    connected: true,
    joinedAt: now - 10,
    lastSeenAt: now,
  };
  const room = {
    hostSessionId: host.sessionId,
    players: new Map([
      [olderConnected.sessionId, olderConnected],
      [host.sessionId, host],
    ]),
  };

  ensureHostSession(room);
  assert.equal(room.hostSessionId, host.sessionId);
});

test('pruneDisconnectedPlayers removes only expired disconnected players by default', () => {
  const now = Date.now();
  const staleDisconnected = {
    sessionId: 'stale',
    connected: false,
    joinedAt: now - 1000,
    lastSeenAt: now - 50_000,
  };
  const freshDisconnected = {
    sessionId: 'fresh',
    connected: false,
    joinedAt: now - 900,
    lastSeenAt: now - 5_000,
  };
  const connected = {
    sessionId: 'on',
    connected: true,
    joinedAt: now - 800,
    lastSeenAt: now,
  };
  const room = {
    lastActiveAt: now - 1000,
    players: new Map([
      [staleDisconnected.sessionId, staleDisconnected],
      [freshDisconnected.sessionId, freshDisconnected],
      [connected.sessionId, connected],
    ]),
  };
  const clearedSessions = [];
  const clearMarksForSession = (_room, sessionId) => {
    clearedSessions.push(sessionId);
  };

  const removed = pruneDisconnectedPlayers(room, now, 30_000, clearMarksForSession);
  assert.equal(removed, 1);
  assert.equal(room.players.has(staleDisconnected.sessionId), false);
  assert.equal(room.players.has(freshDisconnected.sessionId), true);
  assert.equal(room.players.has(connected.sessionId), true);
  assert.deepEqual(clearedSessions, ['stale']);
  assert.equal(getConnectedPlayerCount(room), 1);
});

test('pruneDisconnectedPlayers with force=true removes all disconnected players', () => {
  const now = Date.now();
  const room = {
    lastActiveAt: now - 1000,
    players: new Map([
      ['a', { sessionId: 'a', connected: false, joinedAt: now - 3, lastSeenAt: now - 100 }],
      ['b', { sessionId: 'b', connected: false, joinedAt: now - 2, lastSeenAt: now - 100 }],
      ['c', { sessionId: 'c', connected: true, joinedAt: now - 1, lastSeenAt: now }],
    ]),
  };

  const removed = pruneDisconnectedPlayers(room, now, 60_000, () => {}, { force: true });
  assert.equal(removed, 2);
  assert.equal(room.players.size, 1);
  assert.equal(room.players.has('c'), true);
});

test('getRoomReadinessError enforces connected ready team players', () => {
  const now = Date.now();
  const baseRoom = {
    players: new Map(),
  };

  assert.equal(getRoomReadinessError(baseRoom), 'At least one connected player is required to start.');

  baseRoom.players.set('spectator', {
    sessionId: 'spectator',
    connected: true,
    team: 'none',
    role: 'spectator',
    ready: false,
    joinedAt: now,
    lastSeenAt: now,
  });
  assert.equal(getRoomReadinessError(baseRoom), 'At least one connected team player is required to start.');

  baseRoom.players.set('agent', {
    sessionId: 'agent',
    connected: true,
    team: 'red',
    role: 'operative',
    ready: false,
    joinedAt: now + 1,
    lastSeenAt: now + 1,
  });
  assert.equal(getRoomReadinessError(baseRoom), 'Waiting for 1 player(s) to ready up.');

  baseRoom.players.get('agent').ready = true;
  assert.equal(getRoomReadinessError(baseRoom), null);
});
