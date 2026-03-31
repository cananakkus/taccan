import { state, STAMP_SVG_NS, STAMP_PATHS } from './state.js';
import { ui } from './ui.js';
import { t, formatCardWord, getLocaleTag } from './i18n.js';
import {
  canHint, canGuess, canHostRematch, getCurrentMaxHintCount,
  formatTeam, formatResultReason, truncateMarkerName,
} from './helpers.js';
import { playSound } from './sound.js';
import { renderPhaseTimer, renderSelectedGuess } from './render-timer.js';

// --- Card Diff State ---
let _prevBoard = null;
let _prevGameId = null;
let _lastBannerText = '';

export function invalidateBoardCache() {
  _prevBoard = null;
  _lastBannerText = '';
}

export function cardNeedsUpdate(prev, curr) {
  if (prev.revealed !== curr.revealed) return true;
  if (prev.color !== curr.color) return true;
  if (prev.word !== curr.word) return true;
  const prevMarks = prev.marks || [];
  const currMarks = curr.marks || [];
  if (prevMarks.length !== currMarks.length) return true;
  for (let i = 0; i < currMarks.length; i++) {
    if (prevMarks[i]?.sessionId !== currMarks[i]?.sessionId) return true;
    if (prevMarks[i]?.confidence !== currMarks[i]?.confidence) return true;
  }
  return false;
}

export function setTurnBannerText(text) {
  if (text === _lastBannerText) return;
  _lastBannerText = text;
  ui.turnBanner.classList.add('banner-swap');
  setTimeout(() => {
    ui.turnBanner.textContent = text;
    ui.turnBanner.classList.remove('banner-swap');
  }, 150);
}

export function clearBoard() {
  for (const el of state.cardElements) {
    el.className = 'card';
    el.disabled = true;
    el.removeAttribute('aria-label');
    el.title = '';
    const frontWord = el.querySelector('.card-front .card-word');
    const backWord = el.querySelector('.card-back .card-word');
    if (frontWord) frontWord.textContent = '';
    if (backWord) backWord.textContent = '';
    const stampSlot = el.querySelector('.card-stamp-slot');
    if (stampSlot) stampSlot.innerHTML = '';
    const markers = el.querySelector('.card-markers');
    if (markers) markers.innerHTML = '';
    el.classList.remove('revealed', 'red', 'blue', 'neutral', 'assassin', 'keycard',
      'marked', 'clickable', 'selected-for-guess', 'fresh-reveal', 'finished-reveal');
  }
}

export function setTurnBannerStyle(game) {
  ui.turnBanner.classList.remove('red', 'blue', 'finished');
  if (!game) return;
  if (game.phase === 'finished') {
    ui.turnBanner.classList.add('finished');
    return;
  }
  ui.turnBanner.classList.add(game.currentTeam === 'red' ? 'red' : 'blue');
}

export function createRevealStamp(color) {
  if (!color) return null;
  const stamp = document.createElement('span');
  stamp.className = 'card-stamp';
  if (color === 'neutral') {
    stamp.classList.add('stamp-neutral-x');
    return stamp;
  }
  const pathData = STAMP_PATHS[color];
  if (!pathData) return null;
  stamp.classList.add(
    color === 'red' ? 'stamp-red-bird' : color === 'blue' ? 'stamp-blue-bird' : 'stamp-assassin-bird'
  );
  const svg = document.createElementNS(STAMP_SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(STAMP_SVG_NS, 'path');
  path.setAttribute('d', pathData);
  svg.appendChild(path);
  stamp.appendChild(svg);
  return stamp;
}

export function renderGame(snapshot) {
  const game = snapshot.game;
  setTurnBannerStyle(game);

  const placeholder = document.getElementById('ctrl-placeholder');

  if (!game) {
    if (placeholder) placeholder.classList.remove('hidden');
    setTurnBannerText(t('lobby_open'));
    ui.scoreBarRed.style.width = '0%';
    ui.scoreBarBlue.style.width = '0%';
    ui.hintSection.classList.add('hidden');
    ui.guessSection.classList.add('hidden');
    ui.resultSection.classList.add('hidden');
    clearBoard();
    state.revealedCardIndexes = new Set();
    state.activeGameId = null;
    state.selectedGuessIndex = null;
    if (ui.selectedGuess) ui.selectedGuess.textContent = t('no_card_selected');
    if (ui.submitGuessButton) ui.submitGuessButton.disabled = true;
    if (ui.rematchButton && ui.swapRematchButton) {
      ui.rematchButton.classList.add('hidden');
      ui.swapRematchButton.classList.add('hidden');
      ui.rematchButton.disabled = true;
      ui.swapRematchButton.disabled = true;
    }
    if (ui.ggButton) ui.ggButton.classList.add('hidden');
    if (ui.debriefButton) ui.debriefButton.classList.add('hidden');
    renderPhaseTimer(snapshot);
    return;
  }

  if (placeholder) placeholder.classList.add('hidden');

  if (game.id && state.activeGameId !== game.id) {
    state.activeGameId = game.id;
    state.revealedCardIndexes = new Set();
    state.selectedGuessIndex = null;

    // Card deal animation — staggered cascade
    for (let i = 0; i < state.cardElements.length; i++) {
      const card = state.cardElements[i];
      card.classList.add('card-deal');
      card.style.animationDelay = `${40 * i}ms`;
      card.addEventListener('animationend', function handler() {
        card.classList.remove('card-deal');
        card.style.animationDelay = '';
        card.removeEventListener('animationend', handler);
      }, { once: true });
    }
  }

  // Competition bar: found cards fill from each side
  const redTotal = game.startingTeam === 'red' ? 9 : 8;
  const blueTotal = game.startingTeam === 'blue' ? 9 : 8;
  const totalCards = redTotal + blueTotal;
  const redFound = redTotal - game.remaining.red;
  const blueFound = blueTotal - game.remaining.blue;
  ui.scoreBarRed.style.width = `${(redFound / totalCards) * 100}%`;
  ui.scoreBarBlue.style.width = `${(blueFound / totalCards) * 100}%`;

  if (game.phase === 'finished') {
    const roundLabel = Number.isInteger(game.roundNumber) ? t('round_prefix', { round: game.roundNumber }) : '';
    setTurnBannerText(t('game_over_banner', {
      round: roundLabel,
      team: formatTeam(game.winner),
    }));
    ui.resultSection.classList.remove('hidden');
    if (!ui.resultSection.classList.contains('result-flourish')) {
      ui.resultSection.classList.add('result-flourish');
      ui.resultSection.addEventListener('animationend', function handler() {
        ui.resultSection.classList.remove('result-flourish');
        ui.resultSection.removeEventListener('animationend', handler);
      }, { once: true });
    }
    const matchLabel = game.matchId ? t('result_match_label', { id: String(game.matchId).slice(0, 8) }) : '';
    ui.resultText.textContent = `${formatResultReason(game)} ${matchLabel}`.trim();
    if (ui.ggButton) ui.ggButton.classList.remove('hidden');
    if (ui.debriefButton) ui.debriefButton.classList.remove('hidden');
  } else if (game.phase === 'hint') {
    setTurnBannerText(t('turn_spymaster_choosing', { team: formatTeam(game.currentTeam) }));
    ui.resultSection.classList.add('hidden');
    if (ui.ggButton) ui.ggButton.classList.add('hidden');
    if (ui.debriefButton) ui.debriefButton.classList.add('hidden');
  } else {
    setTurnBannerText(t('turn_operatives_guessing', { team: formatTeam(game.currentTeam) }));
    ui.resultSection.classList.add('hidden');
    if (ui.ggButton) ui.ggButton.classList.add('hidden');
    if (ui.debriefButton) ui.debriefButton.classList.add('hidden');
  }

  renderPhaseTimer(snapshot);

  if (ui.rematchButton && ui.swapRematchButton) {
    const rematchAllowed = canHostRematch(snapshot);
    ui.rematchButton.classList.toggle('hidden', !rematchAllowed);
    ui.swapRematchButton.classList.toggle('hidden', !rematchAllowed);
    ui.rematchButton.disabled = !rematchAllowed;
    ui.swapRematchButton.disabled = !rematchAllowed;
  }

  const hintInteractive = canHint(snapshot);
  const guessInteractive = canGuess(snapshot);

  // Spymasters see hint form; operatives see guess section; spectators see neither
  const isSpymaster = snapshot.me.role === 'spymaster';
  const isOperative = snapshot.me.role === 'operative';
  const showHint = isSpymaster && game.phase !== 'finished';
  const showGuess = isOperative && game.phase !== 'finished';

  ui.hintSection.classList.toggle('hidden', !showHint);
  ui.guessSection.classList.toggle('hidden', !showGuess);
  if (showHint) ui.hintSection.classList.toggle('locked', !hintInteractive);
  if (showGuess) ui.guessSection.classList.toggle('locked', !guessInteractive);

  const hintMax = getCurrentMaxHintCount(snapshot);
  ui.hintWordInput.disabled = !hintInteractive;
  ui.hintCountInput.disabled = !hintInteractive;
  ui.hintCountInput.max = String(hintMax ?? 50);
  if (hintMax !== null && Number(ui.hintCountInput.value) > hintMax) {
    ui.hintCountInput.value = String(hintMax);
  }
  if (ui.hintSubmitButton) ui.hintSubmitButton.disabled = !hintInteractive;
  ui.endTurnButton.disabled = !guessInteractive;

  if (ui.hintStatus) {
    if (hintInteractive) {
      ui.hintStatus.textContent = t('hint_status_your_turn');
    } else if (game.phase === 'finished') {
      ui.hintStatus.textContent = t('hint_status_game_finished');
    } else if (game.phase !== 'hint') {
      ui.hintStatus.textContent = t('hint_status_operatives_guessing', { team: formatTeam(game.currentTeam) });
    } else {
      ui.hintStatus.textContent = t('hint_status_spymaster_locked', { team: formatTeam(game.currentTeam) });
    }
  }

  if (game.hint) {
    const remaining = game.guessesRemaining === null ? t('unlimited') : String(Math.max(game.guessesRemaining, 0));
    ui.hintDisplay.textContent = t('hint_display', {
      word: String(game.hint.word || '').toLocaleUpperCase(getLocaleTag()),
      count: game.hint.count,
      remaining,
    });
  } else {
    ui.hintDisplay.textContent = t('awaiting_hint');
  }

  if (ui.guessNote) {
    if (guessInteractive) {
      ui.guessNote.textContent = t('guess_note_active');
    } else if (game.phase === 'finished') {
      ui.guessNote.textContent = t('guess_note_finished');
    } else if (game.phase !== 'guess') {
      ui.guessNote.textContent = t('guess_note_waiting');
    } else {
      ui.guessNote.textContent = t('guess_note_restricted');
    }
  }
  renderSelectedGuess(snapshot);

  // --- Render board cards ---
  const revealedNow = new Set();
  const boardChanged = !_prevBoard || game.id !== _prevGameId;

  for (const card of game.board) {
    const cardButton = state.cardElements[card.index];
    if (!cardButton) continue;

    // Skip unchanged cards (but always re-render on new game or phase transitions that affect interactivity)
    const prev = boardChanged ? null : _prevBoard?.[card.index];
    const interactivityChanged = prev && (
      prev._guessInteractive !== guessInteractive ||
      prev._selectedGuessIndex !== state.selectedGuessIndex ||
      prev._gameFinished !== (game.phase === 'finished')
    );
    if (prev && !cardNeedsUpdate(prev, card) && !interactivityChanged) {
      if (card.revealed) revealedNow.add(card.index);
      continue;
    }

    cardButton.className = 'card';
    cardButton.disabled = false;
    cardButton.title = '';

    const frontWord = cardButton.querySelector('.card-front .card-word');
    const backWord = cardButton.querySelector('.card-back .card-word');
    const stampSlot = cardButton.querySelector('.card-stamp-slot');
    const markersEl = cardButton.querySelector('.card-markers');

    const displayWord = formatCardWord(card.word);
    if (frontWord) frontWord.textContent = displayWord;
    if (backWord) backWord.textContent = displayWord;
    if (markersEl) markersEl.innerHTML = '';
    if (stampSlot) stampSlot.innerHTML = '';

    const revealedLabel = card.revealed ? t('revealed') || 'revealed' : t('unrevealed') || 'unrevealed';
    const colorLabel = card.revealed || (card.color && snapshot.me.role === 'spymaster') ? card.color : '';
    cardButton.setAttribute('aria-label',
      `${t('card')} ${card.index + 1}: ${displayWord}, ${revealedLabel}${colorLabel ? ', ' + colorLabel : ''}`
    );

    if (card.revealed) {
      revealedNow.add(card.index);
      cardButton.classList.add('revealed', card.color);

      const stamp = createRevealStamp(card.color);
      if (stamp && stampSlot) stampSlot.appendChild(stamp);

      if (!state.revealedCardIndexes.has(card.index)) {
        playSound('cardFlip');
      }
      cardButton.disabled = true;
    } else {
      if (card.color) {
        cardButton.classList.add('keycard', card.color);
      }

      if (game.phase === 'finished' && game.showKeycard && card.color) {
        cardButton.classList.add('finished-reveal', card.color);
      }

      if (Array.isArray(card.marks) && card.marks.length > 0) {
        cardButton.classList.add('marked');
        const markerNames = card.marks.map((mark) => mark.name);
        cardButton.title = t('marked_by', { names: markerNames.join(', ') });

        if (markersEl) {
          for (const mark of card.marks) {
            const chip = document.createElement('span');
            const confidenceClass = mark.confidence === 'tentative' ? ' tentative' : '';
            chip.className = `card-marker ${mark.team === 'red' ? 'red' : mark.team === 'blue' ? 'blue' : 'neutral'}${confidenceClass}`;
            chip.textContent = truncateMarkerName(mark.name);
            chip.title = `${mark.name} (${formatTeam(mark.team)})`;
            markersEl.appendChild(chip);
          }
        }
      }

      if (guessInteractive) {
        cardButton.classList.add('clickable');
      } else {
        cardButton.disabled = true;
      }

      if (guessInteractive && state.selectedGuessIndex === card.index) {
        cardButton.classList.add('selected-for-guess');
      }
    }
  }

  state.revealedCardIndexes = revealedNow;

  // Save board snapshot for diffing
  _prevGameId = game.id;
  _prevBoard = game.board.map((card) => ({
    ...card,
    marks: card.marks ? [...card.marks] : [],
    _guessInteractive: guessInteractive,
    _selectedGuessIndex: state.selectedGuessIndex,
    _gameFinished: game.phase === 'finished',
  }));
}
