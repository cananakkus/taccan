import { state } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';
import { formatCardWord } from './i18n.js';
import { canGuess, getPhaseTimerRemainingMs, formatTimerRemaining } from './helpers.js';

export function renderPhaseTimer(snapshot) {
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

export function shouldRunLiveTicker(snapshot) {
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
