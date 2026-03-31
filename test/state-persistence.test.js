const test = require('node:test');
const assert = require('node:assert/strict');
const { saveState, loadState, restoreRooms } = require('../backend/state-persistence');
const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.taccan-state.json');

function createMockRoom() {
  return {
    code: 'TEST',
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    hostSessionId: 'session-1',
    mode: 'casual',
    match: { id: 'match-1', roundNumber: 1 },
    chatMessages: [{ text: 'hello', by: 'session-1', at: Date.now() }],
    blitzConfig: null,
    customWords: null,
    voicePeers: new Set(),
    players: new Map([
      ['session-1', {
        sessionId: 'session-1',
        socketId: 'sock-1',
        name: 'Alice',
        team: 'red',
        role: 'spymaster',
        connected: true,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      }],
      ['session-2', {
        sessionId: 'session-2',
        socketId: 'sock-2',
        name: 'Bob',
        team: 'blue',
        role: 'operative',
        connected: false,
        joinedAt: Date.now(),
        lastSeenAt: Date.now(),
      }],
    ]),
    game: {
      id: 'game-1',
      matchId: 'match-1',
      roundNumber: 1,
      mode: 'casual',
      phase: 'hint',
      currentTeam: 'red',
      startingTeam: 'red',
      seed: 42,
      phaseTimer: { id: 'timer-1', phase: 'hint', startedAt: Date.now(), endsAt: Date.now() + 25000, durationMs: 25000 },
      hint: null,
      guessesRemaining: 0,
      remaining: { red: 9, blue: 8 },
      winner: null,
      loser: null,
      reason: null,
      turnNumber: 1,
      maxHintCount: null,
      board: Array.from({ length: 25 }, (_, i) => ({
        index: i,
        word: `WORD${i}`,
        color: i === 0 ? 'assassin' : i < 10 ? 'red' : i < 18 ? 'blue' : 'neutral',
        revealed: false,
        revealedBy: null,
      })),
      marksByCard: Array.from({ length: 25 }, (_, i) => {
        const s = new Set();
        if (i === 0) s.add('session-1');
        return s;
      }),
      history: [],
      mvpVotes: {},
    },
  };
}

test('saveState and restoreRooms round-trip preserves room data', () => {
  const rooms = new Map();
  rooms.set('TEST', createMockRoom());

  const saved = saveState(rooms);
  assert.ok(saved, 'saveState should return truthy');

  const loaded = loadState();
  assert.ok(loaded, 'loadState should return data');
  assert.ok(Array.isArray(loaded), 'loaded data is an array');

  const restored = restoreRooms(loaded);
  assert.ok(restored instanceof Map, 'restoreRooms returns a Map');
  assert.equal(restored.size, 1);

  const room = restored.get('TEST');
  assert.ok(room);
  assert.equal(room.code, 'TEST');
  assert.equal(room.mode, 'casual');
  assert.equal(room.match.id, 'match-1');
  assert.equal(room.match.roundNumber, 1);
  assert.ok(room.players instanceof Map);
  assert.equal(room.players.size, 2);
});

test('saveState resets connection state and phaseTimer', () => {
  const rooms = new Map();
  rooms.set('TEST', createMockRoom());

  saveState(rooms);
  const loaded = loadState();
  const restored = restoreRooms(loaded);
  const room = restored.get('TEST');

  for (const player of room.players.values()) {
    assert.equal(player.connected, false, 'players should be disconnected after restore');
    assert.equal(player.socketId, null, 'socketId should be null after restore');
  }

  assert.equal(room.game.phaseTimer, null, 'phaseTimer should be null after restore');
});

test('marksByCard Sets survive serialization', () => {
  const rooms = new Map();
  rooms.set('TEST', createMockRoom());

  saveState(rooms);
  const loaded = loadState();
  const restored = restoreRooms(loaded);
  const room = restored.get('TEST');

  assert.ok(room.game.marksByCard[0] instanceof Set, 'marksByCard entries should be Sets');
  assert.ok(room.game.marksByCard[0].has('session-1'), 'marks should be preserved');
  assert.equal(room.game.marksByCard[1].size, 0, 'empty marks should be empty Sets');
});

// Cleanup: ensure state file is removed
test.afterEach(() => {
  try { fs.unlinkSync(STATE_FILE); } catch (_e) {}
});
