const test = require('node:test');
const assert = require('node:assert/strict');
const words = require('../backend/words');
const associations = require('../backend/bot-associations');
const { createGameState, mulberry32, resolveGuess, advanceTurn } = require('../backend/game-engine');
const { chooseClue, chooseGuess, relatedness, sameFamily, clueToWords } = require('../backend/bots');

test('association table only links real board words and covers every one', () => {
  const vocab = new Set(words.map((word) => word.toUpperCase()));
  const covered = new Set();
  for (const [clue, list] of Object.entries(associations)) {
    assert.match(clue, /^[a-z]+$/, clue);
    assert.equal(vocab.has(clue.toUpperCase()), false, `${clue} is a board word`);
    for (const word of list.split(' ')) { assert.ok(vocab.has(word.toUpperCase()), `${clue}: ${word}`); covered.add(word.toUpperCase()); }
  }
  assert.deepEqual([...vocab].filter((word) => !covered.has(word)), []);
});

test('relatedness understands table links, plurals, co-occurrence and unknown clues', () => {
  assert.equal(relatedness('animal', 'DOG'), 1);
  assert.equal(relatedness('Animals', 'DOG'), 1);
  assert.ok(relatedness('dog', 'WOLF') > 0.3);
  assert.ok(relatedness('puppies', 'DOG') > 0.3 || relatedness('dogs', 'DOG') > 0.3);
  assert.equal(relatedness('xyzzy', 'DOG'), 0);
});

function playRound(redSkill, blueSkill, seed) {
  const game = createGameState({ seed });
  const rng = mulberry32(seed ^ 0x5bd1e995);
  const seat = (team, role) => ({ sessionId: `${team}-${role}-${seed}`, team, role, skill: team === 'red' ? redSkill : blueSkill });
  const seats = { red: [seat('red', 'spymaster'), seat('red', 'operative')], blue: [seat('blue', 'spymaster'), seat('blue', 'operative')] };
  for (let step = 0; step < 300 && game.phase !== 'finished'; step += 1) {
    const [spymaster, operative] = seats[game.currentTeam];
    if (game.phase === 'hint') {
      const clue = chooseClue(game, spymaster, rng);
      assert.ok(clue.count >= 1);
      assert.ok(!game.board.some((card) => !card.revealed && sameFamily(clue.word, card.word)), clue.word);
      game.hint = { word: clue.word, count: clue.count, team: game.currentTeam };
      game.phase = 'guess'; game.guessesRemaining = clue.count + 1;
      game.history.push({ type: 'hint', team: game.currentTeam, word: clue.word, count: clue.count });
    } else {
      const decision = chooseGuess(game, operative, rng);
      if (decision.type === 'guess') resolveGuess(game, operative, game.board[decision.index]);
      else advanceTurn(game, 'player_ended');
    }
  }
  assert.equal(game.phase, 'finished');
  return game;
}

test('bot operatives decide from visible information only', () => {
  const game = createGameState({ seed: 42 });
  const clue = chooseClue(game, { sessionId: 's', team: game.currentTeam, skill: 'hard' }, mulberry32(1));
  Object.assign(game, { phase: 'guess', hint: { word: clue.word, count: clue.count, team: game.currentTeam }, guessesRemaining: clue.count + 1 });
  const blind = { ...game, board: game.board.map((card) => ({ ...card, color: card.revealed ? card.color : null })) };
  const operative = { sessionId: 'o', team: game.currentTeam, skill: 'normal' };
  assert.deepEqual(chooseGuess(game, operative, mulberry32(7)), chooseGuess(blind, operative, mulberry32(7)));
});

test('hard spymasters avoid the assassin and skill changes results', () => {
  const game = createGameState({ seed: 9 });
  for (let i = 0; i < 20; i += 1) {
    const clue = chooseClue(game, { sessionId: `h${i}`, team: game.currentTeam, skill: 'hard' }, Math.random);
    const assassin = game.board.find((card) => card.color === 'assassin');
    assert.equal(clueToWords.get(clue.word)?.has(assassin.word) || false, false);
  }
  let hardWins = 0, easyAssassins = 0, hardAssassins = 0;
  for (let seed = 1; seed <= 80; seed += 1) {
    const game = playRound('hard', 'easy', seed);
    if (game.winner === 'red') hardWins += 1;
    if (game.reason === 'assassin') (game.loser === 'red' ? hardAssassins += 1 : easyAssassins += 1);
  }
  assert.ok(hardWins >= 60, `hard won ${hardWins}/80`);
  assert.ok(easyAssassins > hardAssassins, `${easyAssassins} vs ${hardAssassins}`);
});
