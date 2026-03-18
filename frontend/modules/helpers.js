import { state } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';


export function canHint(snapshot) {
  return Boolean(
    snapshot.game &&
      snapshot.game.phase === 'hint' &&
      snapshot.me.role === 'spymaster' &&
      snapshot.me.team === snapshot.game.currentTeam
  );
}

export function canGuess(snapshot) {
  return Boolean(
    snapshot.game &&
      snapshot.game.phase === 'guess' &&
      snapshot.me.role === 'operative' &&
      snapshot.me.team === snapshot.game.currentTeam
  );
}

export function canMark(snapshot, index) {
  if (!canGuess(snapshot)) return false;
  const card = snapshot.game?.board?.[index];
  return Boolean(card && !card.revealed);
}

export function canHostRematch(snapshot) {
  if (!snapshot || !snapshot.me?.isHost) return false;
  return Boolean(snapshot.game && snapshot.game.phase === 'finished');
}

export function getReadinessIssue(snapshot) {
  if (!snapshot) return t('readiness_join_first');
  if (snapshot.game && snapshot.game.phase !== 'finished') return t('readiness_game_running');
  const connectedPlayers = snapshot.players.filter((player) => player.connected);
  if (connectedPlayers.length < 1) return t('readiness_need_connected');
  const connectedTeamPlayers = connectedPlayers.filter(
    (player) => player.team !== 'none' && player.role !== 'spectator'
  );
  if (connectedTeamPlayers.length < 1) return t('readiness_need_team_player');
  return null;
}

export function getRoomMode(snapshot) {
  const mode = snapshot?.room?.mode;
  if (mode === 'blitz' || mode === 'cipher' || mode === 'blackout') return mode;
  return 'casual';
}

export function getCurrentMaxHintCount(snapshot) {
  const fromGame = snapshot?.game?.maxHintCount;
  if (Number.isInteger(fromGame) && fromGame > 0) return fromGame;
  const fromRoomConfig = snapshot?.room?.modeConfig?.maxHintCount;
  if (Number.isInteger(fromRoomConfig) && fromRoomConfig > 0) return fromRoomConfig;
  return getRoomMode(snapshot) === 'blitz' ? 5 : 9;
}

export function getPhaseTimerRemainingMs(snapshot) {
  const endsAt = snapshot?.game?.phaseTimer?.endsAt;
  if (!endsAt) return 0;
  return Math.max(0, Number(endsAt) - Date.now());
}

export function formatTeam(team) {
  if (team === 'red') return t('team_red');
  if (team === 'blue') return t('team_blue');
  return t('team_unknown');
}

export function formatResultReason(game) {
  if (game.reason === 'assassin') return t('result_assassin', { loser: formatTeam(game.loser) });
  if (game.reason === 'all_agents_revealed') return t('result_all_agents', { winner: formatTeam(game.winner) });
  if (game.reason === 'opponent_agents_revealed') return t('result_opponent_agents', { winner: formatTeam(game.winner) });
  return t('result_generic', { winner: formatTeam(game.winner) });
}

export function truncateMarkerName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) return t('anonymous');
  const maxLength = 11;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

export function formatRoleLabel(role) {
  if (role === 'spymaster') return t('spymaster');
  if (role === 'operative') return t('operative');
  if (role === 'spectator') return t('spectator');
  return String(role || '');
}

export function formatTimerRemaining(remainingMs) {
  const totalSeconds = Math.max(0, Math.ceil(Number(remainingMs) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function setConnection(isOnline, label) {
  ui.connectionDot.classList.toggle('online', isOnline);
  ui.connectionDot.classList.toggle('offline', !isOnline);
  ui.connectionDot.title = label;
}

export function showToast(message, type = '') {
  ui.toast.textContent = message;
  ui.toast.classList.remove('hidden', 'toast-success', 'toast-error', 'toast-info');
  if (type) ui.toast.classList.add(`toast-${type}`);
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    ui.toast.classList.add('hidden');
  }, 2400);
}

export function announce(message) {
  if (!ui.srAnnouncements) return;
  ui.srAnnouncements.textContent = '';
  requestAnimationFrame(() => {
    ui.srAnnouncements.textContent = message;
  });
}

export function confirmAction(message) {
  const overlay = document.getElementById('confirm-overlay');
  const msgEl = document.getElementById('confirm-message');
  const yesBtn = document.getElementById('confirm-yes-btn');
  const noBtn = document.getElementById('confirm-no-btn');
  if (!overlay || !msgEl || !yesBtn || !noBtn) return Promise.resolve(window.confirm(message));
  return new Promise((resolve) => {
    msgEl.textContent = message;
    overlay.classList.remove('hidden');
    function cleanup(result) {
      overlay.classList.add('hidden');
      yesBtn.removeEventListener('click', onYes);
      noBtn.removeEventListener('click', onNo);
      resolve(result);
    }
    function onYes() { cleanup(true); }
    function onNo() { cleanup(false); }
    yesBtn.addEventListener('click', onYes);
    noBtn.addEventListener('click', onNo);
  });
}

export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
