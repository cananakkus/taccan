const ASSOCIATIONS = require('./bot-associations');
const { finishGame } = require('./game-engine');

// Skill profiles. `know` is the share of association links a bot recognises,
// `noise` blurs an operative's ranking, `maxCount` caps clue size, and `pick` is
// how many of the best clues a spymaster chooses between.
const SKILLS = {
  easy: { know: 0.6, noise: 0.7, maxCount: 2, pick: 6, risk: 'reckless', stopEarly: 0.3, bonus: false },
  normal: { know: 0.88, noise: 0.25, maxCount: 3, pick: 3, risk: 'careful', stopEarly: 0, bonus: false },
  hard: { know: 1, noise: 0.05, maxCount: 4, pick: 1, risk: 'safe', stopEarly: 0, bonus: true },
};
const SKILL_VALUES = Object.keys(SKILLS);
const FALLBACK_CLUES = ['THING', 'SOMETHING', 'STUFF', 'OBJECT', 'ITEM'];

const clueToWords = new Map();
const wordToClues = new Map();
for (const [clue, list] of Object.entries(ASSOCIATIONS)) {
  const words = list.split(' ').map((word) => word.toUpperCase());
  clueToWords.set(clue.toUpperCase(), new Set(words));
  for (const word of words) {
    if (!wordToClues.has(word)) wordToClues.set(word, new Set());
    wordToClues.get(word).add(clue.toUpperCase());
  }
}

function hash32(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0) / 4294967296;
}

// Stable per bot and game, so a bot does not "forget" a link between moves.
function knows(bot, gameId, clue, word, rate) {
  return rate >= 1 || hash32(`${bot.sessionId}|${gameId}|${clue}|${word}`) < rate;
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

// Same family as a board word (contains it, or shares most of its stem).
function sameFamily(a, b) {
  if (a.length >= 3 && b.includes(a)) return true;
  if (b.length >= 3 && a.includes(b)) return true;
  return commonPrefix(a, b) >= Math.max(4, Math.min(a.length, b.length) - 1);
}

function clueVariants(raw) {
  const word = String(raw || '').normalize('NFC').toUpperCase().replace(/[^A-Z]/g, '');
  const variants = new Set([word]);
  for (const suffix of ['S', 'ES', 'ING', 'ED', 'ER', 'Y', 'IES']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) variants.add(word.slice(0, -suffix.length));
  }
  if (word.endsWith('IES')) variants.add(word.slice(0, -3) + 'Y');
  return [...variants].filter(Boolean);
}

function stemMatch(a, b) {
  return commonPrefix(a, b) >= Math.max(3, Math.min(a.length, b.length) - 1);
}

// How strongly a hint points at a board word, from 0 to 1. Direct table links
// score 1; a hint that is itself a board-vocabulary word scores by the clues it
// shares with the card (co-occurrence); a clue whose targets share a clue with
// the card is a faint second-hand link.
function relatedness(hint, word) {
  let best = 0;
  for (const variant of clueVariants(hint)) {
    if (clueToWords.get(variant)?.has(word)) return 1;
    if (variant === word) continue;
    const wordClues = wordToClues.get(word) || new Set();
    if (wordToClues.has(variant)) {
      let shared = 0;
      for (const clue of wordToClues.get(variant)) if (wordClues.has(clue)) shared += 1;
      if (shared) best = Math.max(best, Math.min(0.8, 0.4 + 0.15 * shared));
    } else if (clueToWords.has(variant)) {
      for (const target of clueToWords.get(variant)) {
        if ([...wordToClues.get(target)].some((clue) => clue !== variant && wordClues.has(clue))) { best = Math.max(best, 0.2); break; }
      }
    }
    if (variant.length >= 3 && stemMatch(variant, word)) best = Math.max(best, 0.6);
  }
  return best;
}

function skillOf(bot) {
  return SKILLS[bot.skill] || SKILLS.normal;
}

function chooseClue(game, bot, rng = Math.random) {
  const skill = skillOf(bot);
  const team = bot.team;
  const opponent = team === 'red' ? 'blue' : 'red';
  const open = game.board.filter((card) => !card.revealed);
  const forbidden = (clue) => open.some((card) => sameFamily(clue, card.word));
  const rate = (risk) => {
  const options = [];
  for (const [clue, words] of clueToWords) {
    if (forbidden(clue)) continue;
    let own = 0, opp = 0, neutral = 0, assassin = 0;
    for (const card of open) {
      if (!words.has(card.word) || !knows(bot, game.id, clue, card.word, skill.know)) continue;
      if (card.color === team) own += 1;
      else if (card.color === opponent) opp += 1;
      else if (card.color === 'assassin') assassin += 1;
      else neutral += 1;
    }
    if (!own) continue;
    if (risk === 'safe' && (assassin || opp)) continue;
    if (risk === 'careful' && assassin) continue;
    const count = Math.min(own, skill.maxCount);
    const penalty = risk === 'reckless'
      ? assassin * 1.5 + opp * 0.5 + neutral * 0.2
      : assassin * 5 + opp * 1.2 + neutral * 0.5;
    options.push({ clue, count, score: count - penalty });
  }
  return options;
  };
  const options = rate(skill.risk);
  if (!options.length && skill.risk !== 'reckless') options.push(...rate('reckless'));
  options.sort((a, b) => b.score - a.score || b.count - a.count || a.clue.localeCompare(b.clue));
  if (!options.length) {
    // Nothing fits cleanly: point at one of our words with any clue that names it.
    const ours = open.filter((card) => card.color === team);
    for (const card of ours.sort(() => rng() - 0.5)) {
      const clue = [...(wordToClues.get(card.word) || [])].find((candidate) => !forbidden(candidate));
      if (clue) return { word: clue, count: 1 };
    }
    return { word: FALLBACK_CLUES.find((clue) => !forbidden(clue)) || 'HINT', count: 1 };
  }
  const top = options[0].score;
  const pool = options.slice(0, skill.pick).filter((option) => option.score > top - 1.5);
  const choice = pool[Math.floor(rng() * pool.length)] || options[0];
  const count = skill.risk === 'reckless' && rng() < 0.35 ? 1 : choice.count;
  return { word: choice.clue, count };
}

// Earlier clues for this team that still have unfound words.
function unfinishedHints(game, team) {
  const hints = [];
  let current = null;
  for (const entry of game.history) {
    if (entry.type === 'hint') { current = entry.team === team ? { word: entry.word, count: entry.count, found: 0 } : null; if (current) hints.push(current); }
    else if (entry.type === 'guess' && current && entry.team === team && entry.color === team) current.found += 1;
  }
  hints.pop(); // the clue currently being guessed
  return hints.filter((hint) => hint.found < hint.count);
}

// An operative's decision. Uses only what an operative can see: words, revealed
// cards and clues, never hidden colours.
function chooseGuess(game, bot, rng = Math.random) {
  const skill = skillOf(bot);
  const hint = game.hint;
  if (!hint) return { type: 'end' };
  const made = hint.count + 1 - game.guessesRemaining;
  const open = game.board.filter((card) => !card.revealed);
  const ranked = open.map((card) => {
    let rel = relatedness(hint.word, card.word);
    if (rel > 0 && !knows(bot, game.id, hint.word.toUpperCase(), card.word, skill.know)) rel *= 0.2;
    return { card, rel, score: rel + rng() * skill.noise };
  }).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { type: 'end' };
  if (made < hint.count) {
    if (made > 0 && rng() < skill.stopEarly) return { type: 'end' };
    if (made === 0 || ranked[0].rel >= 0.3) return { type: 'guess', index: ranked[0].card.index, rel: ranked[0].rel };
    return { type: 'end' };
  }
  if (skill.bonus) {
    let best = null;
    for (const old of unfinishedHints(game, bot.team)) {
      best = open.find((card) => relatedness(old.word, card.word) >= 1 && relatedness(hint.word, card.word) < 0.3);
      if (best) break;
    }
    if (best) return { type: 'guess', index: best.index, rel: 1 };
  }
  return { type: 'end' };
}

function suggestion(game, bot, rng) {
  const decision = chooseGuess(game, bot, rng);
  return decision.type === 'guess' ? decision.index : null;
}

// Plays every bot seat in party rooms: clues, guesses and turn ends, on a
// human-like delay. Bots defer to human operatives on their team and only guess
// after those teammates have been idle for `deferMs`.
function createBotDriver(ctx, { delayScale = 1, deferMs = 20_000, rng = Math.random } = {}) {
  const pending = new Map();
  let closed = false;

  const active = (room, player) => !room.party.forfeits.includes(player.sessionId);
  const sorted = (list) => list.sort((a, b) => a.joinedAt - b.joinedAt || a.sessionId.localeCompare(b.sessionId));
  const delay = (min, max) => Math.round((min + rng() * (max - min)) * delayScale);

  function nextActor(room) {
    const game = room.game;
    if (!room.party || !game || game.phase === 'finished') return null;
    const team = [...room.players.values()].filter((p) => p.team === game.currentTeam && active(room, p));
    if (game.phase === 'hint') {
      const spymaster = sorted(team.filter((p) => p.role === 'spymaster'))[0];
      return spymaster?.bot ? { bot: spymaster, kind: 'hint' } : null;
    }
    const operatives = team.filter((p) => p.role === 'operative');
    const bot = sorted(operatives.filter((p) => p.bot))[0];
    if (!bot) return null;
    return { bot, kind: 'guess', defer: operatives.some((p) => !p.bot && p.connected) };
  }

  function keyOf(room, plan) {
    const game = room.game;
    return `${game.id}|${game.turnNumber}|${game.phase}|${game.guessesRemaining}|${plan.bot.sessionId}`;
  }

  function cancel(code) {
    const entry = pending.get(code);
    if (entry) { clearTimeout(entry.timer); pending.delete(code); }
  }

  function schedule(room, key, wait, entry = {}) {
    const timer = setTimeout(() => fire(room.code, key), Math.max(0, wait));
    timer.unref?.();
    pending.set(room.code, { ...entry, key, timer });
  }

  function kick(room) {
    if (closed || !room?.party) return;
    const plan = nextActor(room);
    if (!plan) { cancel(room.code); return; }
    const key = keyOf(room, plan);
    if (pending.get(room.code)?.key === key) return;
    cancel(room.code);
    schedule(room, key, plan.kind === 'hint' ? delay(1200, 3000) : delay(700, 2200), { since: Date.now() });
  }

  function act(room, plan, { instant = false } = {}) {
    const { applyHint, applyGuess, applyEndTurn, applyMark } = ctx.helpers;
    const game = room.game;
    if (plan.kind === 'hint') {
      const clue = chooseClue(game, plan.bot, rng);
      applyHint(room, plan.bot, clue.word, clue.count);
      return true;
    }
    if (plan.defer && !instant) {
      const entry = pending.get(room.code);
      const idleSince = Math.max(entry?.since || 0, game.lastActionAt || 0);
      if (!entry?.marked) {
        const index = suggestion(game, plan.bot, rng);
        if (index !== null && !game.marksByCard[index]?.has(plan.bot.sessionId)) applyMark(room, plan.bot, index, { touch: false });
      }
      const wait = idleSince + deferMs * delayScale - Date.now();
      if (wait > 0) { schedule(room, keyOf(room, plan), wait, { since: entry?.since || Date.now(), marked: true }); return false; }
    }
    const decision = chooseGuess(game, plan.bot, rng);
    if (decision.type === 'guess') applyGuess(room, plan.bot, game.board[decision.index]);
    else applyEndTurn(room);
    return true;
  }

  function fire(code, key) {
    const room = ctx.rooms.get(code);
    if (closed || !room) return;
    ctx.helpers.withRoomLock(code, () => {
      if (pending.get(code)?.key !== key) return;
      const plan = nextActor(room);
      if (!plan || keyOf(room, plan) !== key) { pending.delete(code); kick(room); return; }
      const entry = pending.get(code);
      if (!act(room, plan)) return; // rescheduled while human teammates think
      if (pending.get(code) === entry) pending.delete(code);
      kick(room);
    }).catch((error) => {
      ctx.helpers.logEvent('bot_action_failed', { roomCode: code, message: error.message });
      pending.delete(code);
    });
  }

  // When only bots remain, play the rest of the round out immediately.
  function finishWithoutHumans(room) {
    for (let step = 0; step < 200 && room.game && room.game.phase !== 'finished'; step += 1) {
      const plan = nextActor(room);
      if (!plan) break;
      act(room, plan, { instant: true });
    }
    if (room.game && room.game.phase !== 'finished') {
      finishGame(room.game, null, null, 'forfeit');
      ctx.helpers.clearPhaseTimerState(room);
    }
    cancel(room.code);
  }

  return {
    kick,
    finishWithoutHumans,
    close() { closed = true; for (const code of [...pending.keys()]) cancel(code); },
  };
}

module.exports = { SKILLS, SKILL_VALUES, createBotDriver, chooseClue, chooseGuess, relatedness, sameFamily, clueToWords, wordToClues };
