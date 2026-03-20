const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeHint, createGameState, createDuetGameState, resolveGuess, mulberry32 } = require('../backend/game-engine');

test('normalizeHint accepts single-word alpha hint and rejects invalid forms', () => {
  assert.equal(normalizeHint('  Galaxy  '), 'Galaxy');
  assert.equal(normalizeHint(''), null);
  assert.equal(normalizeHint('two words'), null);
  assert.equal(normalizeHint('hint_1'), null);
});

test('createGameState builds a 25-card board with valid color distribution', () => {
  const game = createGameState();
  assert.equal(game.board.length, 25);

  const words = new Set(game.board.map((card) => card.word));
  assert.equal(words.size, 25);

  const counts = { red: 0, blue: 0, neutral: 0, assassin: 0 };
  for (const card of game.board) {
    counts[card.color] += 1;
  }

  assert.equal(counts.assassin, 1);
  assert.equal(counts.neutral, 7);
  assert.equal(counts.red + counts.blue, 17);
  assert.equal(game.remaining.red + game.remaining.blue, 17);
});

test('createGameState preserves optional match metadata', () => {
  const game = createGameState({ matchId: 'match-123', roundNumber: 4 });
  assert.equal(game.matchId, 'match-123');
  assert.equal(game.roundNumber, 4);
  assert.equal(game.mode, 'casual');
  assert.equal(game.maxHintCount, null);
  assert.equal(game.phaseTimer, null);
});

test('createGameState supports blitz mode options', () => {
  const game = createGameState({ mode: 'blitz', maxHintCount: 5 });
  assert.equal(game.mode, 'blitz');
  assert.equal(game.maxHintCount, 5);
  assert.equal(game.phaseTimer, null);
});

test('resolveGuess ends game when assassin is revealed', () => {
  const game = {
    id: 'g1',
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    phase: 'guess',
    currentTeam: 'red',
    startingTeam: 'red',
    turnNumber: 3,
    hint: { word: 'space', count: 1, team: 'red', by: 'p1', at: Date.now() },
    guessesRemaining: 2,
    remaining: { red: 3, blue: 3 },
    winner: null,
    loser: null,
    reason: null,
    board: [
      { index: 0, word: 'ALPHA', color: 'assassin', revealed: false, revealedBy: null },
      { index: 1, word: 'BETA', color: 'red', revealed: false, revealedBy: null },
    ],
    marksByCard: [new Set(), new Set()],
    history: [],
  };

  const result = resolveGuess(game, { sessionId: 'p1', team: 'red' }, game.board[0]);
  assert.equal(result.finished, true);
  assert.equal(game.phase, 'finished');
  assert.equal(game.winner, 'blue');
  assert.equal(game.loser, 'red');
  assert.equal(game.reason, 'assassin');
});

test('resolveGuess enforces guess limit and advances turn on final allowed correct guess', () => {
  const game = {
    id: 'g2',
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    phase: 'guess',
    currentTeam: 'red',
    startingTeam: 'red',
    turnNumber: 5,
    hint: { word: 'metal', count: 1, team: 'red', by: 'p1', at: Date.now() },
    guessesRemaining: 1,
    remaining: { red: 2, blue: 2 },
    winner: null,
    loser: null,
    reason: null,
    board: [
      { index: 0, word: 'IRON', color: 'red', revealed: false, revealedBy: null },
      { index: 1, word: 'WAVE', color: 'blue', revealed: false, revealedBy: null },
    ],
    marksByCard: [new Set(['p1']), new Set()],
    history: [],
  };

  const result = resolveGuess(game, { sessionId: 'p1', team: 'red' }, game.board[0]);
  assert.equal(result.finished, false);
  assert.equal(result.endedTurn, true);
  assert.equal(result.turnEndReason, 'guess_limit_reached');
  assert.equal(game.phase, 'hint');
  assert.equal(game.currentTeam, 'blue');
  assert.equal(game.turnNumber, 6);
  assert.equal(game.guessesRemaining, 0);
  assert.equal(game.hint, null);
});

// --- Wave 8.1: Seeded PRNG determinism ---
test('same seed produces identical boards', () => {
  const seed = 42;
  const game1 = createGameState({ seed });
  const game2 = createGameState({ seed });

  assert.equal(game1.startingTeam, game2.startingTeam);
  assert.equal(game1.seed, seed);
  assert.equal(game2.seed, seed);

  for (let i = 0; i < 25; i++) {
    assert.equal(game1.board[i].word, game2.board[i].word);
    assert.equal(game1.board[i].color, game2.board[i].color);
  }
});

test('different seeds produce different boards', () => {
  const game1 = createGameState({ seed: 1 });
  const game2 = createGameState({ seed: 99999 });

  // At least some words should differ (overwhelmingly likely)
  const sameWords = game1.board.filter((c, i) => c.word === game2.board[i].word).length;
  assert.ok(sameWords < 25, 'Different seeds should produce different boards');
});

// --- Wave 9.3: Duet mode ---
test('createDuetGameState produces valid duet board', () => {
  const game = createDuetGameState({ seed: 123 });
  assert.equal(game.mode, 'duet');
  assert.equal(game.board.length, 25);
  assert.equal(game.turnsRemaining, 9);
  assert.equal(game.totalAgents, 15);
  assert.equal(game.currentPlayer, 'A');

  // Each card should have dual keycards
  for (const card of game.board) {
    assert.ok(['agent', 'assassin', 'bystander'].includes(card.colorForPlayerA));
    assert.ok(['agent', 'assassin', 'bystander'].includes(card.colorForPlayerB));
  }

  // Each keycard: 9 agents, 3 assassins, 13 bystanders
  const countsA = { agent: 0, assassin: 0, bystander: 0 };
  const countsB = { agent: 0, assassin: 0, bystander: 0 };
  for (const card of game.board) {
    countsA[card.colorForPlayerA]++;
    countsB[card.colorForPlayerB]++;
  }
  assert.equal(countsA.agent, 9);
  assert.equal(countsA.assassin, 3);
  assert.equal(countsA.bystander, 13);
  assert.equal(countsB.agent, 9);
  assert.equal(countsB.assassin, 3);
  assert.equal(countsB.bystander, 13);
});

// --- mulberry32 PRNG ---
test('mulberry32 produces deterministic sequence', () => {
  const rng1 = mulberry32(12345);
  const rng2 = mulberry32(12345);

  for (let i = 0; i < 100; i++) {
    assert.equal(rng1(), rng2());
  }
});
