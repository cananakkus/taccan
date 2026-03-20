const { randomUUID } = require('crypto');
const words = require('./words');

// --- Seeded PRNG (Wave 8.1) ---
function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizeHint(value) {
  const trimmed = String(value || '').trim().normalize('NFC');
  if (!trimmed) {
    return null;
  }

  // Accept Unicode letters, combining marks (accents, etc.), and hyphens
  if (!/^\p{L}[\p{L}\p{M}-]*$/u.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function getOtherTeam(team) {
  return team === 'red' ? 'blue' : 'red';
}

function shuffle(items, rng) {
  const random = rng || Math.random;
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function sampleWords(count, rng, wordList) {
  const pool = wordList || words;
  if (pool.length < count) {
    throw new Error('Not enough words to generate board.');
  }

  const shuffled = shuffle([...pool], rng);
  return shuffled.slice(0, count).map((word) => word.toUpperCase());
}

function createGameState(options = {}) {
  const matchId =
    typeof options.matchId === 'string' && options.matchId.trim() ? options.matchId.trim() : null;
  const roundNumber =
    Number.isInteger(options.roundNumber) && options.roundNumber > 0 ? options.roundNumber : null;
  const mode = options.mode === 'blitz' ? 'blitz' : 'casual';
  const maxHintCount = options.maxHintCount ?? null;

  // Seeded PRNG (Wave 8.1)
  const seed = options.seed || (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const rng = mulberry32(seed);

  const startingTeam = rng() < 0.5 ? 'red' : 'blue';
  const otherTeam = getOtherTeam(startingTeam);
  const colors = shuffle([
    ...new Array(9).fill(startingTeam),
    ...new Array(8).fill(otherTeam),
    ...new Array(7).fill('neutral'),
    'assassin',
  ], rng);

  const wordList = options.customWords && options.customWords.length >= 25
    ? options.customWords
    : words;

  const board = sampleWords(25, rng, wordList).map((word, index) => ({
    index,
    word,
    color: colors[index],
    revealed: false,
    revealedBy: null,
  }));

  const gameState = {
    id: randomUUID(),
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    matchId,
    roundNumber,
    mode,
    maxHintCount,
    seed,
    phaseTimer: null,
    phase: 'hint',
    currentTeam: startingTeam,
    startingTeam,
    turnNumber: 1,
    hint: null,
    guessesRemaining: 0,
    remaining: {
      red: startingTeam === 'red' ? 9 : 8,
      blue: startingTeam === 'blue' ? 9 : 8,
    },
    winner: null,
    loser: null,
    reason: null,
    board,
    marksByCard: Array.from({ length: 25 }, () => new Set()),
    history: [],
    mvpVotes: {},
  };

  return gameState;
}

// --- Duet Mode (Wave 9.3) ---
function createDuetGameState(options = {}) {
  const seed = options.seed || (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const rng = mulberry32(seed);

  const wordList = options.customWords && options.customWords.length >= 25
    ? options.customWords
    : words;
  const boardWords = sampleWords(25, rng, wordList);

  // Duet keycards: 9 agents, 3 assassins, 13 bystanders per player's perspective
  // Some overlap: shared agents, shared assassins
  const keycardA = generateDuetKeycard(rng);
  const keycardB = generateDuetKeycard(rng);

  const board = boardWords.map((word, index) => ({
    index,
    word,
    colorForPlayerA: keycardA[index],
    colorForPlayerB: keycardB[index],
    revealed: false,
    revealedBy: null,
  }));

  return {
    id: randomUUID(),
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    matchId: options.matchId || null,
    roundNumber: options.roundNumber || null,
    mode: 'duet',
    seed,
    phase: 'hint',
    currentPlayer: 'A',
    turnsRemaining: 9,
    board,
    marksByCard: Array.from({ length: 25 }, () => new Set()),
    history: [],
    agentsFound: 0,
    totalAgents: 15,
    winner: null,
    reason: null,
  };
}

function generateDuetKeycard(rng) {
  const colors = [
    ...new Array(9).fill('agent'),
    ...new Array(3).fill('assassin'),
    ...new Array(13).fill('bystander'),
  ];
  return shuffle(colors, rng);
}

function resolveGuess(game, player, card) {
  card.revealed = true;
  card.revealedBy = player.team;
  if (game.marksByCard[card.index]) {
    game.marksByCard[card.index].clear();
  }

  const opponentTeam = getOtherTeam(player.team);
  const result = {
    color: card.color,
    outcome: card.color,
    endedTurn: false,
    turnEndReason: null,
    finished: false,
  };

  game.history.push({
    type: 'guess',
    by: player.sessionId,
    team: player.team,
    index: card.index,
    color: card.color,
    at: Date.now(),
  });

  if (card.color === 'assassin') {
    finishGame(game, opponentTeam, player.team, 'assassin');
    result.finished = true;
    return result;
  }

  if (card.color === player.team) {
    game.remaining[player.team] -= 1;

    if (game.remaining[player.team] <= 0) {
      finishGame(game, player.team, opponentTeam, 'all_agents_revealed');
      result.finished = true;
      result.outcome = 'team_win';
      return result;
    }

    if (game.guessesRemaining !== null) {
      game.guessesRemaining -= 1;
      if (game.guessesRemaining <= 0) {
        advanceTurn(game, 'guess_limit_reached');
        result.endedTurn = true;
        result.turnEndReason = 'guess_limit_reached';
      }
    }

    return result;
  }

  if (card.color === opponentTeam) {
    game.remaining[opponentTeam] -= 1;

    if (game.remaining[opponentTeam] <= 0) {
      finishGame(game, opponentTeam, player.team, 'opponent_agents_revealed');
      result.finished = true;
      result.outcome = 'opponent_win';
      return result;
    }

    advanceTurn(game, 'opponent_card');
    result.endedTurn = true;
    result.turnEndReason = 'opponent_card';
    return result;
  }

  advanceTurn(game, 'neutral_card');
  result.endedTurn = true;
  result.turnEndReason = 'neutral_card';
  return result;
}

function advanceTurn(game, reason) {
  clearAllCardMarks(game);

  game.history.push({
    type: 'turn_end',
    reason,
    endedAt: Date.now(),
    previousTeam: game.currentTeam,
  });

  game.currentTeam = getOtherTeam(game.currentTeam);
  game.phase = 'hint';
  game.turnNumber += 1;
  game.hint = null;
  game.guessesRemaining = 0;
  game.lastActionAt = Date.now();
}

function clearAllCardMarks(game) {
  if (!game || !Array.isArray(game.marksByCard)) {
    return;
  }

  for (const marks of game.marksByCard) {
    marks.clear();
  }
}

function finishGame(game, winner, loser, reason) {
  game.phase = 'finished';
  game.winner = winner;
  game.loser = loser;
  game.reason = reason;
  game.guessesRemaining = 0;
  game.lastActionAt = Date.now();

  game.history.push({
    type: 'game_end',
    winner,
    loser,
    reason,
    at: Date.now(),
  });

  clearAllCardMarks(game);
}

module.exports = {
  mulberry32,
  normalizeHint,
  getOtherTeam,
  createGameState,
  createDuetGameState,
  resolveGuess,
  advanceTurn,
  clearAllCardMarks,
  finishGame,
  sampleWords,
  shuffle,
};
