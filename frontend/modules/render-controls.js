import { ui } from './ui.js';
import { t } from './i18n.js';
import { getReadinessIssue, getRoomMode } from './helpers.js';

export function renderControls(snapshot) {
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
    const modeLabels = { casual: t('mode_casual'), blitz: t('mode_blitz') };
    ui.modeBadge.textContent = modeLabels[roomMode] || t('mode_casual');
    ui.modeBadge.classList.toggle('blitz', roomMode === 'blitz');
  }

  const blitzConfig = document.getElementById('blitz-config');
  if (blitzConfig) {
    blitzConfig.classList.toggle('hidden', roomMode !== 'blitz' || gameActive);
    if (roomMode === 'blitz') {
      const hintSec = Math.round(Number(snapshot.room?.modeConfig?.hintTimerMs || 25_000) / 1000);
      const guessSec = Math.round(Number(snapshot.room?.modeConfig?.guessTimerMs || 35_000) / 1000);
      const hintInput = document.getElementById('blitz-hint-sec');
      const guessInput = document.getElementById('blitz-guess-sec');
      if (hintInput && document.activeElement !== hintInput) hintInput.value = String(hintSec);
      if (guessInput && document.activeElement !== guessInput) guessInput.value = String(guessSec);
      if (!isHost) {
        if (hintInput) hintInput.disabled = true;
        if (guessInput) guessInput.disabled = true;
      } else {
        if (hintInput) hintInput.disabled = false;
        if (guessInput) guessInput.disabled = false;
      }
    }
  }

  if (ui.modeNote) {
    if (roomMode === 'blitz') {
      const hintTimerMs = Number(snapshot.room?.modeConfig?.hintTimerMs || 25_000);
      const guessTimerMs = Number(snapshot.room?.modeConfig?.guessTimerMs || 35_000);
      ui.modeNote.textContent = t('mode_note_blitz', {
        hint: Math.round(hintTimerMs / 1000),
        guess: Math.round(guessTimerMs / 1000),
      });
    } else {
      ui.modeNote.textContent = t('mode_note_casual');
    }
  }
}
