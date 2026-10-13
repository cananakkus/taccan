const ASSOCIATIONS = require('./bot-associations');

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

// Turkish. Bot clues come from a bilingual table (clues-tr.json) and board
// words have Turkish names (words-tr.json), so a Turkish clue a person types
// is read back to English: exact matches first, then after peeling common
// suffixes (plural, case, possessive, -lı/-sız/-cı/-lık) and undoing final
// consonant softening (köpeği -> köpek).
const WORDS_TR = require('./words-tr.json');
const CLUES_TR = require('./clues-tr.json');
const trLower = (text) => String(text || '').normalize('NFC').toLocaleLowerCase('tr-TR').replace(/[^a-zçğıöşüâîû]/g, '');
const TR_TO_EN = new Map();
for (const [en, tr] of [...Object.entries(WORDS_TR), ...Object.entries(CLUES_TR)]) {
  const key = trLower(tr);
  if (!TR_TO_EN.has(key)) TR_TO_EN.set(key, new Set());
  TR_TO_EN.get(key).add(en.toUpperCase());
}
const TR_SUFFIXES = ['lerin', 'ların', 'leri', 'ları', 'ler', 'lar', 'nın', 'nin', 'nun', 'nün', 'dan', 'den', 'tan', 'ten', 'lık', 'lik', 'luk', 'lük', 'sız', 'siz', 'suz', 'süz',
  'da', 'de', 'ta', 'te', 'yı', 'yi', 'yu', 'yü', 'ya', 'ye', 'ın', 'in', 'un', 'ün', 'sı', 'si', 'su', 'sü', 'lı', 'li', 'lu', 'lü', 'cı', 'ci', 'cu', 'cü', 'çı', 'çi', 'çu', 'çü', 'ı', 'i', 'u', 'ü', 'a', 'e'];
const SOFTENED = { 'ğ': ['k', 'g'], 'b': ['p'], 'c': ['ç'], 'd': ['t'] };
function turkishReadings(raw) {
  const base = trLower(raw);
  if (base.length < 2) return [];
  const found = new Set();
  const seen = new Set([base]);
  let frontier = [base];
  for (let depth = 0; depth < 3 && frontier.length && !found.size; depth += 1) {
    const next = [];
    for (const form of frontier) {
      const forms = [form, ...(SOFTENED[form.at(-1)] || []).map((hard) => form.slice(0, -1) + hard)];
      for (const candidate of forms) for (const en of TR_TO_EN.get(candidate) || []) found.add(en);
      for (const suffix of TR_SUFFIXES) {
        if (form.length - suffix.length < 2 || !form.endsWith(suffix)) continue;
        const stem = form.slice(0, -suffix.length);
        if (!seen.has(stem)) { seen.add(stem); next.push(stem); }
      }
    }
    frontier = next;
  }
  return [...found];
}
// The Turkish name of an English clue key or board word, if any.
function turkishOf(word) {
  const key = String(word || '').toLowerCase();
  return CLUES_TR[key] || WORDS_TR[key] || null;
}
function sameFamilyTr(a, b) {
  return Boolean(a && b) && sameFamily(trLower(a), trLower(b));
}

function clueVariants(raw) {
  const word = String(raw || '').normalize('NFC').toUpperCase().replace(/[^A-Z]/g, '');
  const variants = new Set([word, ...turkishReadings(raw)]);
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

// Every word a spymaster bot may say: the association table's clues plus board
// vocabulary words (said only when they are not on this board). Relatedness is
// cached per (clue, vocabulary word), lazily.
const VOCAB = [...wordToClues.keys()];
const VOCAB_INDEX = new Map(VOCAB.map((word, index) => [word, index]));
const CANDIDATES = [...new Set([...clueToWords.keys(), ...VOCAB])];
const relRows = new Map();
function cachedRelatedness(clue, word) {
  const index = VOCAB_INDEX.get(word);
  if (index === undefined) return relatedness(clue, word);
  let row = relRows.get(clue);
  if (!row) { row = new Float32Array(VOCAB.length).fill(-1); relRows.set(clue, row); }
  if (row[index] < 0) row[index] = relatedness(clue, word);
  return row[index];
}

// How strongly this bot believes a clue points at a word: links it does not
// know are faint, the same way its operatives read clues.
function perceived(bot, game, clue, word, skill) {
  const rel = cachedRelatedness(clue, word);
  if (rel <= 0) return 0;
  return knows(bot, game.id, clue, word, skill.know) ? rel : rel * 0.2;
}

const STRONG = 0.65; // a target must be at least this clearly linked
const MARGIN = 0.12; // other cards this close to the weakest target are threats

// A spymaster's clue. For every candidate it counts the team's cards the clue
// clearly points at, then checks which other cards an operative could confuse
// with the weakest of those targets. Skill sets how much risk is acceptable,
// the largest count, and how many top options it picks between.
function chooseClue(game, bot, rng = Math.random) {
  const skill = skillOf(bot);
  const team = bot.team;
  const opponent = team === 'red' ? 'blue' : 'red';
  const open = game.board.filter((card) => !card.revealed);
  // A clue may not share a family with an open card in English or in Turkish
  // (the Turkish screen shows Turkish words and the Turkish clue).
  const openTr = open.map((card) => turkishOf(card.word));
  const forbidden = (clue) => open.some((card, i) => sameFamily(clue, card.word) || sameFamilyTr(turkishOf(clue), openTr[i]));
  const given = new Map();
  for (const entry of game.history) if (entry.type === 'hint' && entry.team === team) given.set(entry.word.toUpperCase(), (given.get(entry.word.toUpperCase()) || 0) + 1);
  const rate = (risk) => {
    const options = [];
    for (const clue of CANDIDATES) {
      const rels = [];
      for (const card of open) {
        const rel = perceived(bot, game, clue, card.word, skill);
        if (rel > 0.25) rels.push({ card, rel });
      }
      const own = rels.filter((r) => r.card.color === team && r.rel >= STRONG).sort((a, b) => b.rel - a.rel);
      if (!own.length || forbidden(clue)) continue;
      let best = null;
      for (let n = 1; n <= Math.min(own.length, skill.maxCount); n += 1) {
        const weakest = own[n - 1].rel;
        let opp = 0, neutral = 0, assassin = 0;
        for (const r of rels) {
          if (r.card.color === team || r.rel < weakest - MARGIN) continue;
          if (r.card.color === 'assassin') assassin += 1;
          else if (r.card.color === opponent) opp += 1;
          else neutral += 1;
        }
        if (risk === 'safe' && (assassin || opp)) break;
        if (risk === 'careful' && assassin) break;
        const penalty = risk === 'reckless'
          ? assassin * 1.5 + opp * 0.5 + neutral * 0.25
          : assassin * 5 + opp * 1.2 + neutral * 0.6;
        const score = n - penalty + 0.4 * (weakest - STRONG) - 0.9 * (given.get(clue) || 0);
        if (!best || score > best.score) best = { clue, count: n, score };
      }
      if (best) options.push(best);
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

// Pacing, in ms before delayScale. A spymaster thinks before a clue; an
// operative first marks the card it is about to pick (so people can follow
// along), then reveals it; stopping after the last guess takes a beat too.
const PACE = {
  hint: [4500, 8500],
  perCount: 600,
  aim: [1600, 2800],
  reveal: [1100, 1900],
};

// Plays every bot seat (Play party seats and bots a host added to a room):
// clues, guesses and turn ends, on a human-like delay. Bots defer to human
// operatives on their team and only guess after those teammates have been
// idle for `deferMs`. In a normal room, bots wait while no person is connected.
function createBotDriver(ctx, { delayScale = 1, deferMs = 20_000, rng = Math.random } = {}) {
  const pending = new Map();
  let closed = false;

  const active = (room, player) => !room.party?.forfeits.includes(player.sessionId);
  const hasBots = (room) => [...room.players.values()].some((p) => p.bot);
  const sorted = (list) => list.sort((a, b) => a.joinedAt - b.joinedAt || a.sessionId.localeCompare(b.sessionId));
  const delay = (min, max) => Math.round((min + rng() * (max - min)) * delayScale);

  function nextActor(room) {
    const game = room.game;
    if (!game || game.phase === 'finished') return null;
    if (!room.party && ![...room.players.values()].some((p) => !p.bot && p.connected)) return null;
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
    // Under a blitz clock a bot never thinks for more than a third of what is left.
    const endsAt = room.game?.phaseTimer?.endsAt;
    if (endsAt) wait = Math.min(wait, Math.max(0, (endsAt - Date.now()) / 3));
    const timer = setTimeout(() => {
      try { fire(room.code, key); } catch (error) { ctx.helpers.reportRoomError?.(room, 'bot', error); pending.delete(room.code); }
    }, Math.max(0, wait));
    timer.unref?.();
    pending.set(room.code, { ...entry, key, timer });
  }

  function kick(room) {
    if (closed || !room) return;
    if (!hasBots(room)) { cancel(room.code); return; }
    const plan = nextActor(room);
    if (!plan) { cancel(room.code); return; }
    const key = keyOf(room, plan);
    if (pending.get(room.code)?.key === key) return;
    cancel(room.code);
    const wait = plan.kind === 'hint' ? delay(...PACE.hint) : delay(...PACE.aim);
    schedule(room, key, wait, { since: Date.now() });
  }

  function mark(room, bot, index) {
    if (index === null || index === undefined || room.game.board[index]?.revealed) return;
    if (!room.game.marksByCard[index]?.has(bot.sessionId)) ctx.helpers.applyMark(room, bot, index, { touch: false });
  }

  function act(room, plan) {
    const { applyHint, applyGuess, applyEndTurn } = ctx.helpers;
    const game = room.game;
    const entry = pending.get(room.code);
    if (plan.kind === 'hint') {
      const clue = entry?.clue || chooseClue(game, plan.bot, rng);
      // Bigger clues take a little longer to settle on.
      if (!entry?.clue && clue.count > 1) {
        schedule(room, keyOf(room, plan), delay(PACE.perCount * (clue.count - 1), PACE.perCount * clue.count), { ...entry, clue });
        return false;
      }
      applyHint(room, plan.bot, clue.word, clue.count);
      return true;
    }
    let aim = entry?.aim;
    if (plan.defer) {
      const idleSince = Math.max(entry?.since || 0, game.lastActionAt || 0);
      if (!entry?.marked) {
        aim = suggestion(game, plan.bot, rng);
        mark(room, plan.bot, aim);
      }
      const wait = idleSince + deferMs * delayScale - Date.now();
      if (wait > 0) { schedule(room, keyOf(room, plan), wait, { since: entry?.since || Date.now(), marked: true, aim }); return false; }
    }
    if (aim === undefined || aim === null || game.board[aim]?.revealed) {
      const decision = chooseGuess(game, plan.bot, rng);
      if (decision.type !== 'guess') { applyEndTurn(room); return true; }
      aim = decision.index;
    }
    // Show the pick first, then reveal it.
    if (!entry?.aimed) {
      mark(room, plan.bot, aim);
      schedule(room, keyOf(room, plan), delay(...PACE.reveal), { ...entry, aim, aimed: true, marked: true });
      return false;
    }
    applyGuess(room, plan.bot, game.board[aim]);
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
      ctx.helpers.reportRoomError?.(room, 'bot', error);
      pending.delete(code);
      // Never stall the table: pass the turn in the simplest legal way.
      ctx.helpers.withRoomLock(code, () => {
        const plan = nextActor(room);
        if (!plan || keyOf(room, plan) !== key) return;
        if (plan.kind === 'hint') {
          const open = room.game.board.filter((card) => !card.revealed);
          const word = FALLBACK_CLUES.find((clue) => !open.some((card) => sameFamily(clue, card.word))) || 'HINT';
          ctx.helpers.applyHint(room, plan.bot, word, 1);
        } else ctx.helpers.applyEndTurn(room);
        kick(room);
      }).catch((fallbackError) => ctx.helpers.reportRoomError?.(room, 'bot_fallback', fallbackError));
    });
  }

  return {
    kick,
    cancel,
    nextActor,
    close() { closed = true; for (const code of [...pending.keys()]) cancel(code); },
  };
}

module.exports = { SKILLS, SKILL_VALUES, PACE, turkishReadings, turkishOf, trLower, WORDS_TR, createBotDriver, chooseClue, chooseGuess, relatedness, sameFamily, clueToWords, wordToClues };
