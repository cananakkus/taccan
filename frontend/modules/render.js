import { state, SCENE_CLASSES, STAMP_SVG_NS, STAMP_PATHS } from './state.js';
import { ui } from './ui.js';
import { t, formatCardWord, getLocaleTag } from './i18n.js';
import {
  canHint, canGuess, canHostRematch, getReadinessIssue,
  getRoomMode, getCurrentMaxHintCount, getPhaseTimerRemainingMs,
  formatTeam, formatResultReason, formatRoleLabel, truncateMarkerName,
  formatTimerRemaining, announce,
} from './helpers.js';
import { deriveScene, sceneToBodyClass } from './state-machine.js';
import { getAvatarColor, getInitials } from './identity.js';
import { playSound } from './sound.js';

// --- Turn Banner Swap Helper ---
let _lastBannerText = '';
function setTurnBannerText(text) {
  if (text === _lastBannerText) return;
  _lastBannerText = text;
  ui.turnBanner.classList.add('banner-swap');
  setTimeout(() => {
    ui.turnBanner.textContent = text;
    ui.turnBanner.classList.remove('banner-swap');
  }, 150);
}

// --- Stable Card DOM ---
export function initBoard() {
  ui.board.innerHTML = '';
  state.cardElements = [];
  for (let i = 0; i < 25; i++) {
    const cardButton = document.createElement('button');
    cardButton.type = 'button';
    cardButton.className = 'card';
    cardButton.dataset.cardIndex = String(i);
    cardButton.setAttribute('tabindex', i === 0 ? '0' : '-1');

    const inner = document.createElement('div');
    inner.className = 'card-inner';

    const front = document.createElement('div');
    front.className = 'card-front';
    const word = document.createElement('span');
    word.className = 'card-word';
    front.appendChild(word);

    const back = document.createElement('div');
    back.className = 'card-back';
    const backWord = document.createElement('span');
    backWord.className = 'card-word';
    back.appendChild(backWord);
    const stampSlot = document.createElement('span');
    stampSlot.className = 'card-stamp-slot';
    back.appendChild(stampSlot);

    inner.appendChild(front);
    inner.appendChild(back);
    cardButton.appendChild(inner);

    const markers = document.createElement('div');
    markers.className = 'card-markers';
    cardButton.appendChild(markers);

    ui.board.appendChild(cardButton);
    state.cardElements.push(cardButton);
  }
}

function clearBoard() {
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

// --- CSS Custom Properties as State Bridge ---
function syncCSSStateProperties(snapshot) {
  const root = document.documentElement;
  if (!snapshot) {
    root.style.removeProperty('--phase');
    root.style.removeProperty('--team');
    root.style.removeProperty('--is-my-turn');
    root.style.removeProperty('--turn-number');
    root.style.removeProperty('--cards-revealed');
    root.style.removeProperty('--is-spymaster');
    root.style.removeProperty('--game-active');
    return;
  }
  const game = snapshot.game;
  root.style.setProperty('--phase', game ? game.phase : 'lobby');
  root.style.setProperty('--team', game ? game.currentTeam : 'none');
  const isMyTurn = game && (
    (game.phase === 'hint' && snapshot.me.role === 'spymaster' && snapshot.me.team === game.currentTeam) ||
    (game.phase === 'guess' && snapshot.me.role === 'operative' && snapshot.me.team === game.currentTeam)
  );
  root.style.setProperty('--is-my-turn', isMyTurn ? '1' : '0');
  root.style.setProperty('--turn-number', game ? String(game.turnNumber) : '0');
  const cardsRevealed = game ? game.board.filter(c => c.revealed).length : 0;
  root.style.setProperty('--cards-revealed', String(cardsRevealed));
  root.style.setProperty('--is-spymaster', snapshot.me.role === 'spymaster' ? '1' : '0');
  root.style.setProperty('--game-active', game && game.phase !== 'finished' ? '1' : '0');
}

// --- Scene Class ---
function setSceneClass(snapshot) {
  const scene = deriveScene(snapshot);
  const cls = sceneToBodyClass(scene);
  document.body.classList.remove(...SCENE_CLASSES);
  document.body.classList.add(cls);


}

// --- Live Ticker ---
function shouldRunLiveTicker(snapshot) {
  if (!snapshot) return false;
  const phase = snapshot.game?.phase;
  if (phase !== 'hint' && phase !== 'guess') return false;
  return getPhaseTimerRemainingMs(snapshot) > 0;
}

export function syncLiveTicker(shouldRun) {
  if (shouldRun && !state.liveTicker) {
    state.liveTicker = setInterval(() => {
      if (!shouldRunLiveTicker(state.snapshot)) {
        syncLiveTicker(false);
        return;
      }
      renderPhaseTimer(state.snapshot);
    }, 250);
    return;
  }
  if (!shouldRun && state.liveTicker) {
    clearInterval(state.liveTicker);
    state.liveTicker = null;
  }
}

// --- Main Render ---
export function render() {
  const snapshot = state.snapshot;
  syncCSSStateProperties(snapshot);

  if (!snapshot) {
    for (const button of ui.teamButtons) button.classList.remove('active');
    for (const button of ui.roleButtons) button.classList.remove('active');
    if (ui.startGameButton) {
      ui.startGameButton.classList.add('hidden');
      ui.startGameButton.disabled = true;
      ui.startGameButton.textContent = t('start_game');
    }
    if (ui.pruneButton) {
      ui.pruneButton.classList.add('hidden');
      ui.pruneButton.disabled = true;
    }
    if (ui.spectatorButton) ui.spectatorButton.classList.add('hidden');
    for (const button of ui.modeButtons) {
      button.classList.remove('active');
      button.disabled = true;
      button.title = '';
    }
    if (ui.modeBadge) {
      ui.modeBadge.textContent = t('mode_casual');
      ui.modeBadge.classList.remove('blitz');
    }
    if (ui.modeNote) {
      ui.modeNote.textContent = '';
    }
    if (ui.phaseTimer) {
      ui.phaseTimer.classList.add('hidden');
      ui.phaseTimer.classList.remove('warning-10', 'warning-5', 'hint', 'guess');
    }

    setSceneClass(null);
    state.revealedCardIndexes = new Set();
    state.activeGameId = null;
    state.selectedGuessIndex = null;
    ui.joinPanel.classList.remove('hidden', 'fade-out');
    ui.roomPanel.classList.add('hidden');
    ui.roomPanel.classList.remove('fade-in');
    clearBoard();
    ui.joinNote.textContent = t('join_note_default');
    if (ui.hintHistory) ui.hintHistory.classList.add('hidden');
    if (ui.scratchpad) ui.scratchpad.classList.add('hidden');
    syncLiveTicker(false);
    return;
  }

  if (!ui.joinPanel.classList.contains('hidden') && !state.transitioningToRoom) {
    state.transitioningToRoom = true;
    ui.joinPanel.classList.add('fade-out');
    ui.roomPanel.classList.remove('hidden');
    ui.roomPanel.classList.add('fade-in');
    setTimeout(() => {
      ui.joinPanel.classList.add('hidden');
      ui.joinPanel.classList.remove('fade-out');
      ui.roomPanel.classList.remove('fade-in');
      state.transitioningToRoom = false;
    }, 450);
  } else if (!state.transitioningToRoom) {
    ui.joinPanel.classList.add('hidden');
    ui.roomPanel.classList.remove('hidden');
  }

  ui.roomCode.textContent = snapshot.room.code;
  renderTeamBoxes(snapshot);
  renderControls(snapshot);
  renderGame(snapshot);
  setSceneClass(snapshot);
  renderHintHistory(snapshot);
  syncLiveTicker(shouldRunLiveTicker(snapshot));
}

// --- Team Boxes ---
function renderTeamBoxes(snapshot) {
  const me = snapshot.me;
  ui.redTeamList.innerHTML = '';
  ui.blueTeamList.innerHTML = '';

  const currentIds = new Set();

  for (const player of snapshot.players) {
    const targetList = player.team === 'red' ? ui.redTeamList : player.team === 'blue' ? ui.blueTeamList : null;
    if (!targetList) continue;
    currentIds.add(player.sessionId);
    const item = buildTeamPlayerItem(player, me, snapshot);

    // Highlight newly joined players
    if (state.knownPlayerIds.size > 0 && !state.knownPlayerIds.has(player.sessionId)) {
      item.classList.add('player-new');
      item.addEventListener('animationend', function handler() {
        item.classList.remove('player-new');
        item.removeEventListener('animationend', handler);
      }, { once: true });
    }

    targetList.appendChild(item);
  }

  state.knownPlayerIds = currentIds;

  fillEmptyTeamList(ui.redTeamList, t('no_red_agents'));
  fillEmptyTeamList(ui.blueTeamList, t('no_blue_agents'));
}

function buildTeamPlayerItem(player, me, snapshot) {
  const item = document.createElement('li');
  item.className = 'team-player-item';
  item.dataset.sessionId = player.sessionId;

  // Speaking glow
  if (state.voiceSpeaking.has(player.sessionId)) {
    item.classList.add('speaking');
  }

  const avatar = document.createElement('span');
  avatar.className = 'player-avatar';
  avatar.style.backgroundColor = getAvatarColor(player.name);
  avatar.textContent = getInitials(player.name);
  item.appendChild(avatar);

  const info = document.createElement('div');
  info.className = 'team-player-info';

  const name = document.createElement('div');
  name.className = 'team-player-name';
  name.textContent = player.sessionId === me.sessionId ? `${player.name} ${t('you_suffix')}` : player.name;
  info.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'player-meta';

  const roleTag = document.createElement('span');
  roleTag.className = 'tag';
  roleTag.textContent = formatRoleLabel(player.role);
  meta.appendChild(roleTag);

  if (player.isHost) {
    const hostTag = document.createElement('span');
    hostTag.className = 'tag host';
    hostTag.textContent = t('tag_host');
    meta.appendChild(hostTag);
  }

  if (!player.connected) {
    const offlineTag = document.createElement('span');
    offlineTag.className = 'tag offline';
    offlineTag.textContent = t('tag_offline');
    meta.appendChild(offlineTag);
  }

  // Thinking indicator
  if (snapshot.game && snapshot.game.phase === 'guess' && player.role === 'operative' &&
      player.team === snapshot.game.currentTeam && player.sessionId !== me.sessionId) {
    const hasMarks = snapshot.game.board.some(card =>
      !card.revealed && Array.isArray(card.marks) && card.marks.some(m => m.sessionId === player.sessionId)
    );
    if (hasMarks) {
      const thinkingTag = document.createElement('span');
      thinkingTag.className = 'tag thinking';
      thinkingTag.textContent = '...';
      meta.appendChild(thinkingTag);
    }
  }

  // Voice chat tags
  if (state.voicePeers.has(player.sessionId) ||
      (state.voiceActive && player.sessionId === me.sessionId)) {
    if (state.voiceMutedPeers.has(player.sessionId) ||
        (player.sessionId === me.sessionId && state.voiceMuted)) {
      const mutedTag = document.createElement('span');
      mutedTag.className = 'tag voice-muted';
      mutedTag.textContent = 'MUTED';
      meta.appendChild(mutedTag);
    } else {
      const voiceTag = document.createElement('span');
      voiceTag.className = 'tag voice';
      voiceTag.textContent = 'VOICE';
      meta.appendChild(voiceTag);
    }
  }

  info.appendChild(meta);
  item.appendChild(info);
  return item;
}

function fillEmptyTeamList(list, text) {
  if (!list || list.childElementCount > 0) return;
  const item = document.createElement('li');
  item.className = 'team-empty';
  item.textContent = text;
  list.appendChild(item);
}

// --- Controls ---
function renderControls(snapshot) {
  const gameActive = snapshot.game && snapshot.game.phase !== 'finished';
  const readinessIssue = getReadinessIssue(snapshot);

  for (const button of ui.teamButtons) {
    const isMine = button.dataset.team === snapshot.me.team;
    button.classList.toggle('active', isMine);
    button.disabled = false;
  }

  for (const button of ui.roleButtons) {
    const roleTeam = button.dataset.roleTeam || null;
    const isMine =
      button.dataset.role === snapshot.me.role && (!roleTeam || roleTeam === snapshot.me.team);
    button.classList.toggle('active', isMine);
    button.disabled = false;
  }

  ui.startGameButton.classList.toggle('hidden', !snapshot.me.isHost);
  if (snapshot.me.isHost) {
    ui.startGameButton.textContent = t('start_game');
    ui.startGameButton.disabled = Boolean(gameActive || readinessIssue);
    ui.startGameButton.title = readinessIssue || '';
  } else {
    ui.startGameButton.textContent = t('start_game');
    ui.startGameButton.title = '';
    ui.startGameButton.disabled = true;
  }

  if (ui.pruneButton) {
    ui.pruneButton.classList.toggle('hidden', !snapshot.me.isHost);
    ui.pruneButton.disabled = !snapshot.me.isHost;
  }
  if (ui.spectatorButton) ui.spectatorButton.classList.remove('hidden');

  renderModeControls(snapshot, gameActive);
}

function renderModeControls(snapshot, gameActive) {
  const roomMode = getRoomMode(snapshot);
  const isHost = Boolean(snapshot.me?.isHost);
  const modeMutable = isHost && !gameActive;
  const lockReason = !isHost
    ? t('mode_host_only')
    : gameActive
      ? t('mode_lobby_only_lock')
      : '';

  for (const button of ui.modeButtons) {
    const mode = String(button.dataset.roomMode || '').trim();
    const isActive = mode === roomMode;
    button.classList.toggle('active', isActive);
    button.disabled = !modeMutable || isActive;
    button.title = modeMutable ? '' : lockReason;
  }

  if (ui.modeBadge) {
    const modeLabels = { casual: t('mode_casual'), blitz: t('mode_blitz'), cipher: t('mode_cipher'), blackout: t('mode_blackout') };
    ui.modeBadge.textContent = modeLabels[roomMode] || t('mode_casual');
    ui.modeBadge.classList.toggle('blitz', roomMode === 'blitz');
  }

  if (ui.modeNote) {
    const hintMax = getCurrentMaxHintCount(snapshot);
    if (roomMode === 'blitz') {
      const hintTimerMs = Number(snapshot.room?.modeConfig?.hintTimerMs || 25_000);
      const guessTimerMs = Number(snapshot.room?.modeConfig?.guessTimerMs || 35_000);
      ui.modeNote.textContent = t('mode_note_blitz', {
        hint: Math.round(hintTimerMs / 1000),
        guess: Math.round(guessTimerMs / 1000),
        max: hintMax,
      });
    } else if (roomMode === 'cipher') {
      ui.modeNote.textContent = t('mode_note_cipher', { max: hintMax });
    } else if (roomMode === 'blackout') {
      ui.modeNote.textContent = t('mode_note_blackout', { max: hintMax });
    } else {
      ui.modeNote.textContent = t('mode_note_casual', { max: hintMax });
    }
  }
}

// --- Game Rendering ---
function renderGame(snapshot) {
  const game = snapshot.game;
  setTurnBannerStyle(game);

  if (!game) {
    setTurnBannerText(t('lobby_open'));
    ui.redCount.textContent = t('score_red_empty');
    ui.blueCount.textContent = t('score_blue_empty');
    ui.hintSection.classList.add('hidden');
    ui.guessSection.classList.add('hidden');
    ui.resultSection.classList.add('hidden');
    clearBoard();
    state.revealedCardIndexes = new Set();
    state.activeGameId = null;
    state.selectedGuessIndex = null;
    state.previousRedRemaining = null;
    state.previousBlueRemaining = null;
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
    if (ui.analystButton) ui.analystButton.classList.add('hidden');
    if (ui.scratchpad) ui.scratchpad.classList.add('hidden');
    renderPhaseTimer(snapshot);
    return;
  }

  if (game.id && state.activeGameId !== game.id) {
    state.activeGameId = game.id;
    state.revealedCardIndexes = new Set();
    state.selectedGuessIndex = null;
    state.spymasterSelections.clear();

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

  ui.redCount.textContent = t('score_red', { count: game.remaining.red });
  ui.blueCount.textContent = t('score_blue', { count: game.remaining.blue });

  // Score pulse animation on change
  if (state.previousRedRemaining !== null && state.previousRedRemaining !== game.remaining.red) {
    ui.redCount.classList.add('score-change');
    ui.redCount.addEventListener('animationend', function handler() {
      ui.redCount.classList.remove('score-change');
      ui.redCount.removeEventListener('animationend', handler);
    }, { once: true });
  }
  if (state.previousBlueRemaining !== null && state.previousBlueRemaining !== game.remaining.blue) {
    ui.blueCount.classList.add('score-change');
    ui.blueCount.addEventListener('animationend', function handler() {
      ui.blueCount.classList.remove('score-change');
      ui.blueCount.removeEventListener('animationend', handler);
    }, { once: true });
  }
  state.previousRedRemaining = game.remaining.red;
  state.previousBlueRemaining = game.remaining.blue;

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
    if (ui.analystButton) ui.analystButton.classList.toggle('hidden', !state.aiAvailable);
  } else if (game.phase === 'hint') {
    setTurnBannerText(t('turn_spymaster_choosing', { team: formatTeam(game.currentTeam) }));
    ui.resultSection.classList.add('hidden');
    if (ui.ggButton) ui.ggButton.classList.add('hidden');
    if (ui.debriefButton) ui.debriefButton.classList.add('hidden');
    if (ui.analystButton) ui.analystButton.classList.add('hidden');
  } else {
    setTurnBannerText(t('turn_operatives_guessing', { team: formatTeam(game.currentTeam) }));
    ui.resultSection.classList.add('hidden');
    if (ui.ggButton) ui.ggButton.classList.add('hidden');
    if (ui.debriefButton) ui.debriefButton.classList.add('hidden');
    if (ui.analystButton) ui.analystButton.classList.add('hidden');
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

  // Spymaster selection badge
  if (ui.spymasterBadge) {
    if (showHint && state.spymasterSelections.size > 0) {
      ui.spymasterBadge.textContent = `${state.spymasterSelections.size} / ${ui.hintCountInput.value}`;
      ui.spymasterBadge.classList.remove('hidden');
    } else {
      ui.spymasterBadge.classList.add('hidden');
    }
  }

  // Scratchpad visibility
  if (ui.scratchpad) {
    const showScratchpad = snapshot.me.role === 'spymaster' && game.phase !== 'finished';
    ui.scratchpad.classList.toggle('hidden', !showScratchpad);
  }

  const hintMax = getCurrentMaxHintCount(snapshot);
  ui.hintWordInput.disabled = !hintInteractive;
  ui.hintCountInput.disabled = !hintInteractive;
  ui.hintCountInput.max = String(hintMax);
  if (Number(ui.hintCountInput.value) > hintMax) {
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

  for (const card of game.board) {
    const cardButton = state.cardElements[card.index];
    if (!cardButton) continue;

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
        cardButton.classList.add('fresh-reveal');
        cardButton.addEventListener('animationend', function handler() {
          cardButton.classList.remove('fresh-reveal');
          cardButton.removeEventListener('animationend', handler);
        }, { once: true });
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

      // Spymaster hint-planning: clickable + selection display
      const spymasterPlanning = isSpymaster && game.phase === 'hint' &&
        snapshot.me.team === game.currentTeam;

      if (guessInteractive) {
        cardButton.classList.add('clickable');
      } else if (spymasterPlanning) {
        cardButton.classList.add('clickable');
      } else {
        cardButton.disabled = true;
      }

      if (guessInteractive && state.selectedGuessIndex === card.index) {
        cardButton.classList.add('selected-for-guess');
      }

      if (spymasterPlanning && state.spymasterSelections.has(card.index)) {
        cardButton.classList.add('spymaster-selected');
      }
    }
  }

  // Clear spymaster selections when phase moves past hint
  if (game.phase !== 'hint' && state.spymasterSelections.size > 0) {
    state.spymasterSelections.clear();
  }

  state.revealedCardIndexes = revealedNow;
}

// --- Game Log (grouped hints + guesses) ---
function renderHintHistory(snapshot) {
  if (!ui.hintHistory || !ui.hintHistoryList) return;
  // Always show the log when in a room so the board layout stays stable
  ui.hintHistory.classList.remove('hidden');

  const game = snapshot?.game;

  // Group history: collect guesses under each preceding hint
  const groups = [];
  let current = null;
  for (const event of (game?.history || [])) {
    if (event.type === 'hint') {
      current = { hint: event, guesses: [] };
      groups.push(current);
    } else if (event.type === 'guess' && current) {
      current.guesses.push(event);
    }
  }

  if (groups.length === 0) {
    ui.hintHistoryList.innerHTML = '';
    state.lastLogCount = 0;
    return;
  }

  const existing = ui.hintHistoryList.children;
  const isNewEntry = groups.length > state.lastLogCount;

  // Remove excess groups
  while (existing.length > groups.length) {
    ui.hintHistoryList.removeChild(ui.hintHistoryList.lastChild);
  }

  for (let gi = 0; gi < groups.length; gi++) {
    const group = groups[gi];
    let groupDiv = existing[gi];

    if (!groupDiv) {
      // Create new group
      groupDiv = document.createElement('div');
      groupDiv.className = `log-group ${group.hint.team}`;

      const hintDiv = document.createElement('div');
      hintDiv.className = `log-hint ${group.hint.team}`;
      hintDiv.textContent = `${String(group.hint.word).toLocaleUpperCase(getLocaleTag())} ${group.hint.count}`;
      groupDiv.appendChild(hintDiv);

      ui.hintHistoryList.appendChild(groupDiv);

      // Animate the newest group
      if (isNewEntry && gi === groups.length - 1) {
        groupDiv.classList.add('log-new');
        groupDiv.addEventListener('animationend', function handler() {
          groupDiv.classList.remove('log-new');
          groupDiv.removeEventListener('animationend', handler);
        }, { once: true });
      }
    }

    // Count existing guess elements (skip the first child which is the hint div)
    const existingGuesses = groupDiv.querySelectorAll('.log-guess').length;

    // Only append new guesses
    for (let gsi = existingGuesses; gsi < group.guesses.length; gsi++) {
      const guess = group.guesses[gsi];
      const guessDiv = document.createElement('div');
      guessDiv.className = 'log-guess';
      const card = game.board[guess.index];
      const word = card ? formatCardWord(card.word) : '?';
      const correct = guess.color === guess.team;
      const icon = document.createElement('span');
      icon.className = `guess-icon ${correct ? 'guess-correct' : 'guess-wrong'}`;
      icon.textContent = correct ? '\u2713' : '\u2717';
      guessDiv.appendChild(icon);
      guessDiv.appendChild(document.createTextNode(` ${word}`));
      groupDiv.appendChild(guessDiv);
    }
  }

  state.lastLogCount = groups.length;

  // Auto-scroll the log container to bottom
  ui.hintHistory.scrollTop = ui.hintHistory.scrollHeight;
}

function renderPhaseTimer(snapshot) {
  if (!ui.phaseTimer || !ui.phaseTimerLabel || !ui.phaseTimerValue) return;
  ui.phaseTimer.classList.remove('warning-10', 'warning-5', 'hint', 'guess');
  const game = snapshot?.game;
  const phase = game?.phaseTimer?.phase;
  if (!game || game.phase === 'finished' || (phase !== 'hint' && phase !== 'guess')) {
    ui.phaseTimer.classList.add('hidden');
    return;
  }
  const remainingMs = getPhaseTimerRemainingMs(snapshot);
  ui.phaseTimerLabel.textContent = phase === 'hint' ? t('phase_timer_hint') : t('phase_timer_guess');
  ui.phaseTimerValue.textContent = formatTimerRemaining(remainingMs);
  ui.phaseTimer.classList.toggle('warning-10', remainingMs <= 10_000 && remainingMs > 5_000);
  ui.phaseTimer.classList.toggle('warning-5', remainingMs <= 5_000);
  ui.phaseTimer.classList.add(phase);
  ui.phaseTimer.classList.remove('hidden');
}

export function renderSelectedGuess(snapshot) {
  if (!ui.selectedGuess || !ui.submitGuessButton) return;
  const guessInteractive = canGuess(snapshot);
  ui.submitGuessButton.disabled = !guessInteractive;

  if (!guessInteractive) {
    ui.selectedGuess.textContent = t('no_card_selected');
    state.selectedGuessIndex = null;
    return;
  }
  if (!Number.isInteger(state.selectedGuessIndex)) {
    ui.selectedGuess.textContent = t('select_card_then_submit');
    ui.submitGuessButton.disabled = true;
    return;
  }
  const selectedCard = snapshot.game?.board?.[state.selectedGuessIndex];
  if (!selectedCard || selectedCard.revealed) {
    state.selectedGuessIndex = null;
    ui.selectedGuess.textContent = t('select_card_then_submit');
    ui.submitGuessButton.disabled = true;
    return;
  }
  ui.selectedGuess.textContent = t('selected_card', { word: formatCardWord(selectedCard.word) });
  ui.submitGuessButton.disabled = false;
}

function setTurnBannerStyle(game) {
  ui.turnBanner.classList.remove('red', 'blue', 'finished');
  if (!game) return;
  if (game.phase === 'finished') {
    ui.turnBanner.classList.add('finished');
    return;
  }
  ui.turnBanner.classList.add(game.currentTeam === 'red' ? 'red' : 'blue');
}

function createRevealStamp(color) {
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
