import { state, readSession, writeSession, clearSession } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';
import { setConnection, showToast, announce } from './helpers.js';
import { render } from './render.js';
import { playSound } from './sound.js';
import { canHint, canGuess } from './helpers.js';
import { renderChatHistory, renderChatMessage } from './chat.js';

const basePath = window.location.pathname.replace(/\/[^/]*$/, '');
export const socket = io({ path: basePath + '/socket.io' });

export function wireSocketEvents() {
  socket.on('connect', async () => {
    setConnection(true, t('connected'));
    if (state.wasDisconnected) {
      showToast(t('reconnected'), 'success');
      state.wasDisconnected = false;
    }
    await tryAutoRejoin();
  });

  socket.on('disconnect', () => {
    state.wasDisconnected = true;
    setConnection(false, t('disconnected'));
  });

  socket.on('state:full', (snapshot) => {
    // Turn notification sound
    const game = snapshot.game;
    if (game && game.phase !== 'finished') {
      const isMyTurn = canHint(snapshot) || canGuess(snapshot);
      if (isMyTurn && !state.previousIsMyTurn) {
        playSound('yourTurn');
      }
      state.previousIsMyTurn = isMyTurn;
    } else {
      state.previousIsMyTurn = false;
    }

    state.snapshot = snapshot;
    state.chatMessages = snapshot.room.chatMessages || [];
    writeSession({
      code: snapshot.room.code,
      sessionId: snapshot.me.sessionId,
      name: snapshot.me.name,
    });
    render();
    renderChatHistory();
  });

  socket.on('error:rule_violation', (payload = {}) => {
    showToast(payload.message || t('action_rejected'));
  });

  socket.on('server:info', (payload = {}) => {
    if (payload.message) showToast(payload.message);
  });

  socket.on('connect_error', () => {
    setConnection(false, t('connection_error'));
  });

  socket.on('turn:timer_started', (payload = {}) => {
    const phase = String(payload.phase || '').trim();
    if (phase === 'hint') {
      showToast(t('hint_timer_started'));
      return;
    }
    if (phase === 'guess') {
      showToast(t('guess_timer_started'));
    }
  });

  socket.on('turn:timer_expired', (payload = {}) => {
    const phase = String(payload.phase || '').trim();
    if (phase === 'hint') {
      showToast(t('hint_timer_expired'));
      return;
    }
    if (phase === 'guess') {
      showToast(t('guess_timer_expired'));
    }
  });

  socket.on('turn:guess_resolved', (payload = {}) => {
    const color = payload.color;
    if (color === 'assassin') {
      playSound('assassin');
      announce(t('result_assassin', { loser: payload.team || '' }));
    } else if (color === payload.team) {
      playSound('correct');
    } else {
      playSound('reveal');
    }
  });

  socket.on('turn:hint_accepted', (payload = {}) => {
    const hint = payload.hint;
    if (hint) {
      announce(t('hint_display', { word: hint.word, count: hint.count, remaining: '' }));
    }
  });

  socket.on('game:gg_received', (payload = {}) => {
    const name = payload.name || t('anonymous');
    showToast(`${name}: GG!`);
    playSound('gg');
  });

  socket.on('chat:message', (message = {}) => {
    state.chatMessages.push(message);
    renderChatMessage(message);
  });

  socket.on('game:mvp_result', (payload = {}) => {
    if (payload.winner) {
      showToast(t('mvp_winner', { name: payload.winner.name || '' }));
    }
  });
}

export async function tryAutoRejoin() {
  if (state.rejoinAttempted) return;
  state.rejoinAttempted = true;
  const stored = readSession();
  if (!stored) return;

  ui.nameInput.value = stored.name || '';
  ui.codeInput.value = stored.code || '';

  // Check for /room/XXXX URL pattern (supports subpath deployment)
  const pathMatch = window.location.pathname.match(/\/room\/([A-Za-z0-9]{4})$/);
  if (pathMatch) {
    ui.codeInput.value = pathMatch[1].toUpperCase();
  }

  try {
    await emitWithAck('room:rejoin', {
      code: stored.code,
      sessionId: stored.sessionId,
      name: stored.name,
    });
  } catch (_error) {
    clearSession();
  }
}

export function emitWithAck(event, payload, timeoutMs = 7000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`Request timed out (${event}).`));
    }, timeoutMs);

    socket.emit(event, payload, (response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!response) {
        reject(new Error('No response from server.'));
        return;
      }
      if (response.ok) {
        resolve(response);
        return;
      }
      reject(new Error(response.error || 'Request rejected.'));
    });
  });
}
