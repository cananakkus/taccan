const test = require('node:test'), assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const words = require('../backend/words');
const associations = require('../backend/bot-associations');
const WORDS_TR = require('../backend/words-tr.json');
const CLUES_TR = require('../backend/clues-tr.json');
const { createGameState, mulberry32 } = require('../backend/game-engine');
const { chooseClue, chooseGuess, relatedness, turkishReadings, trLower, sameFamily } = require('../backend/bots');
const { createApp } = require('../backend/server');

test('every board word and bot clue has a distinct Turkish name', () => {
  for (const word of words) assert.ok(WORDS_TR[word], `board word ${word}`);
  for (const clue of Object.keys(associations)) assert.ok(CLUES_TR[clue], `clue ${clue}`);
  const board = new Map();
  for (const [en, tr] of Object.entries(WORDS_TR)) {
    assert.equal(board.has(trLower(tr)), false, `${en} and ${board.get(trLower(tr))} would show the same card`);
    board.set(trLower(tr), en);
  }
  for (const [en, tr] of Object.entries(CLUES_TR)) assert.equal(board.has(trLower(tr)), false, `clue ${en} (${tr}) is a Turkish board word`);
});

test('bots read Turkish clues, with suffixes and softened consonants', () => {
  assert.deepEqual(turkishReadings('deniz'), ['SEA']);
  assert.deepEqual(turkishReadings('Denizler'), ['SEA']);
  assert.deepEqual(turkishReadings('köpeği'), ['DOG']);
  assert.deepEqual(turkishReadings('HAYVANLAR'), ['ANIMAL']);
  assert.deepEqual(turkishReadings('İnek'), ['COW']);
  assert.deepEqual(turkishReadings('qwzx'), []);
  assert.equal(relatedness('hayvan', 'DOG'), 1);
  assert.equal(relatedness('müzik', 'PIANO'), 1);
  assert.ok(relatedness('köpek', 'WOLF') > 0.3, 'a Turkish board word works by co-occurrence');
  // An operative bot follows a Turkish clue to the linked card.
  const game = createGameState({ seed: 5 });
  const target = game.board.find((card) => associations.music.split(' ').includes(card.word.toLowerCase()));
  if (target) {
    Object.assign(game, { phase: 'guess', hint: { word: 'müzik', count: 1, team: game.currentTeam }, guessesRemaining: 2 });
    const decision = chooseGuess(game, { sessionId: 'op', team: game.currentTeam, skill: 'hard' }, mulberry32(3));
    assert.equal(decision.type, 'guess');
    assert.ok(relatedness('müzik', game.board[decision.index].word) >= 0.6);
  }
});

test('bot clues never share a family with an open card in Turkish either', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const game = createGameState({ seed });
    const clue = chooseClue(game, { sessionId: `s${seed}`, team: game.currentTeam, skill: seed % 3 ? 'hard' : 'easy' }, mulberry32(seed));
    const tr = CLUES_TR[clue.word.toLowerCase()] || WORDS_TR[clue.word.toLowerCase()];
    for (const card of game.board) {
      assert.equal(sameFamily(clue.word, card.word), false);
      if (tr) assert.equal(sameFamily(trLower(tr), trLower(WORDS_TR[card.word.toLowerCase()])), false, `${clue.word}/${tr} vs ${card.word}`);
    }
  }
});

test('a clue that is the Turkish name of an open card is rejected; bot clues are flagged', async () => {
  const app = createApp({ restoreState: false, corsOrigin: '*', botDelayScale: 0.01 });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const s = io('http://127.0.0.1:' + app.httpServer.address().port, { transports: ['websocket'], forceNew: true, reconnection: false });
  const ack = (event, payload) => new Promise((resolve) => s.timeout(3000).emit(event, payload, (err, res) => resolve(err ? { ok: false } : res)));
  try {
    await new Promise((r) => s.once('connect', r));
    const { roomCode } = await ack('room:create', { name: 'Ayşe' });
    await ack('role:set', { role: 'spymaster', team: 'red' });
    await ack('room:bot_add', { team: 'red' }); await ack('room:bot_add', { team: 'blue' }); await ack('room:bot_add', { team: 'blue' });
    await ack('game:start', {});
    const room = app.rooms.get(roomCode);
    room.game.currentTeam = 'red'; room.game.phase = 'hint';
    const open = room.game.board.find((card) => !card.revealed);
    const turkish = WORDS_TR[open.word.toLowerCase()].toLocaleUpperCase('tr-TR');
    assert.equal((await ack('turn:hint_submit', { word: turkish, count: 1 })).error, 'Your hint cannot be a word on the board.');
    assert.equal((await ack('turn:hint_submit', { word: 'zümrüt', count: 1 })).ok, true);
    assert.equal(room.game.hint.bot, undefined, 'a person\'s clue is shown as typed');
    // The blue bot spymaster's clue carries the flag that lets clients translate it.
    room.game.phase = 'hint'; room.game.currentTeam = 'blue'; app.helpers?.emitStateToRoom?.(room);
    app.bots.kick(room);
    for (let i = 0; i < 200 && !(room.game.hint?.team === 'blue'); i += 1) await new Promise((r) => setTimeout(r, 10));
    assert.equal(room.game.hint.bot, true);
    assert.ok(room.game.history.some((e) => e.type === 'hint' && e.bot === true));
  } finally {
    s.disconnect(); for (const t of app.phaseTimers.values()) clearTimeout(t);
    await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval);
  }
});
