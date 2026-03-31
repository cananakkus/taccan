import { state, SCENE_CLASSES } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';
import { truncateMarkerName, formatTeam } from './helpers.js';
import { deriveScene, sceneToBodyClass } from './state-machine.js';
import { renderFeed } from './feed.js';
import { showDebriefTab, hideDebriefTab } from './panels.js';
import { renderTeamBoxes } from './render-teams.js';
import { renderControls } from './render-controls.js';
import { renderGame, clearBoard } from './render-board.js';
import { shouldRunLiveTicker, syncLiveTicker as _syncLiveTicker } from './render-timer.js';

// Pin controls-strip height to board height
function syncControlsHeight() {
  const boardArea = document.querySelector('.board-area');
  const strip = document.querySelector('.controls-strip');
  if (!boardArea || !strip) return;
  strip.style.maxHeight = boardArea.offsetHeight + 'px';
}
let _resizeObserverSet = false;
function ensureBoardResizeObserver() {
  if (_resizeObserverSet) return;
  const boardArea = document.querySelector('.board-area');
  if (!boardArea) return;
  _resizeObserverSet = true;
  new ResizeObserver(() => syncControlsHeight()).observe(boardArea);
}

// Re-exports for callers that import from render.js
export { renderSelectedGuess, syncLiveTicker } from './render-timer.js';

// --- Targeted Card Marks Render ---
export function renderCardMarks(index, marks) {
  const cardButton = state.cardElements[index];
  if (!cardButton) return;
  const markersEl = cardButton.querySelector('.card-markers');
  if (!markersEl) return;
  markersEl.innerHTML = '';
  if (Array.isArray(marks) && marks.length > 0) {
    cardButton.classList.add('marked');
    const markerNames = marks.map((m) => m.name);
    cardButton.title = t('marked_by', { names: markerNames.join(', ') });
    for (const mark of marks) {
      const chip = document.createElement('span');
      const confidenceClass = mark.confidence === 'tentative' ? ' tentative' : '';
      chip.className = `card-marker ${mark.team === 'red' ? 'red' : mark.team === 'blue' ? 'blue' : 'neutral'}${confidenceClass}`;
      chip.textContent = truncateMarkerName(mark.name);
      chip.title = `${mark.name} (${formatTeam(mark.team)})`;
      markersEl.appendChild(chip);
    }
  } else {
    cardButton.classList.remove('marked');
    cardButton.title = '';
  }
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
    hideDebriefTab();
    _syncLiveTicker(false);
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
  renderFeed(snapshot);

  // Show/hide debrief tab based on game phase
  if (snapshot.game && snapshot.game.phase === 'finished') {
    showDebriefTab();
  } else {
    hideDebriefTab();
  }

  _syncLiveTicker(shouldRunLiveTicker(snapshot));
  ensureBoardResizeObserver();
  syncControlsHeight();
}
