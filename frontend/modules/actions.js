import { state, clearSession } from './state.js';
import { ui } from './ui.js';
import { t } from './i18n.js';
import { setLanguage } from './i18n.js';
import { socket, emitWithAck } from './socket.js';
import { render, renderSelectedGuess } from './render.js';
import { canGuess, canMark, showToast, getCurrentMaxHintCount, escapeHtml } from './helpers.js';
import { playSound } from './sound.js';
import { triggerHaptic } from './haptics.js';
import { initScratchpad } from './scratchpad.js';
import { renderQRCode } from './qrcode.js';
import { renderRoomSeal } from './room-seal.js';
import { generateDebriefNarrative } from './debrief.js';

const SERVER_ERROR_MAP = {
  'Hint must be a single alphabetical word.': 'hint_invalid_word',
  'Your hint cannot be a word on the board.': 'hint_on_board',
};

function translateServerError(message) {
  const key = SERVER_ERROR_MAP[message];
  return key ? t(key) : message;
}

export function wireUiEvents() {
  for (const button of ui.languageButtons) {
    button.addEventListener('click', () => {
      const nextLanguage = String(button.dataset.language || '').trim();
      setLanguage(nextLanguage, true);
    });
  }

  ui.createButton.addEventListener('click', async () => {
    const name = ui.nameInput.value.trim();
    if (!name) {
      showToast(t('enter_name_create'));
      return;
    }
    ui.createButton.classList.add('btn-loading');
    try {
      const response = await emitWithAck('room:create', { name });
      ui.codeInput.value = response.roomCode;
      ui.joinNote.textContent = t('room_created_share');
      onRoomJoined(response.roomCode);
    } catch (error) {
      showToast(error.message);
    } finally {
      ui.createButton.classList.remove('btn-loading');
    }
  });

  ui.joinButton.addEventListener('click', async () => {
    const name = ui.nameInput.value.trim();
    const code = ui.codeInput.value.trim().toUpperCase();
    if (!name) {
      showToast(t('enter_name_join'));
      return;
    }
    if (!code) {
      showToast(t('enter_room_code'));
      return;
    }
    ui.joinButton.classList.add('btn-loading');
    try {
      const response = await emitWithAck('room:join', { code, name });
      ui.codeInput.value = response.roomCode;
      ui.joinNote.textContent = t('joined_room', { code: response.roomCode });
      onRoomJoined(response.roomCode);
    } catch (error) {
      showToast(error.message);
    } finally {
      ui.joinButton.classList.remove('btn-loading');
    }
  });

  ui.copyRoomButton.addEventListener('click', async () => {
    const snapshot = state.snapshot;
    if (!snapshot) return;
    try {
      await navigator.clipboard.writeText(snapshot.room.code);
      showToast(t('room_code_copied'), 'success');
    } catch (_error) {
      showToast(t('copy_failed'), 'error');
    }
  });

  // Web Share API (Wave 3.5)
  if (ui.shareRoomButton) {
    ui.shareRoomButton.addEventListener('click', async () => {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      const roomUrl = getRoomUrl(snapshot.room.code);
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Taccan', text: t('join_room_share', { code: snapshot.room.code }), url: roomUrl });
        } catch (_error) {}
      } else {
        try {
          await navigator.clipboard.writeText(roomUrl);
          showToast(t('link_copied'), 'success');
        } catch (_error) {
          showToast(t('copy_failed'), 'error');
        }
      }
    });
  }

  ui.leaveRoomButton.addEventListener('click', async () => {
    try {
      await emitWithAck('room:leave', {});
    } catch (_error) {}
    clearSession();
    state.snapshot = null;
    render();
  });

  for (const button of ui.teamButtons) {
    button.addEventListener('click', async () => {
      if (!state.snapshot) {
        showToast(t('join_create_first'));
        return;
      }
      try {
        await emitWithAck('team:set', { team: button.dataset.team });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  for (const button of ui.roleButtons) {
    button.addEventListener('click', async () => {
      if (!state.snapshot) {
        showToast(t('join_create_first'));
        return;
      }
      const role = button.dataset.role;
      const roleTeam = button.dataset.roleTeam;
      if (!role) return;
      try {
        if (roleTeam && state.snapshot.me.team !== roleTeam) {
          await emitWithAck('team:set', { team: roleTeam });
        }
        await emitWithAck('role:set', { role });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  for (const button of ui.modeButtons) {
    button.addEventListener('click', async () => {
      const snapshot = state.snapshot;
      if (!snapshot) return;
      if (!snapshot.me.isHost) {
        showToast(t('host_only_mode_change'));
        return;
      }
      const mode = String(button.dataset.roomMode || '').trim();
      if (!mode) return;
      const gameActive = Boolean(snapshot.game && snapshot.game.phase !== 'finished');
      if (gameActive) {
        showToast(t('mode_lobby_only'));
        return;
      }
      try {
        await emitWithAck('room:mode_set', { mode });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  ui.startGameButton.addEventListener('click', async () => {
    const snapshot = state.snapshot;
    if (!snapshot || !snapshot.me.isHost) return;
    try {
      await emitWithAck('game:start', {});
    } catch (error) {
      showToast(error.message);
    }
  });

  if (ui.rematchButton) {
    ui.rematchButton.addEventListener('click', async () => {
      if (!state.snapshot?.me?.isHost) return;
      try {
        await emitWithAck('game:rematch', { mode: 'same_teams' });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  if (ui.swapRematchButton) {
    ui.swapRematchButton.addEventListener('click', async () => {
      if (!state.snapshot?.me?.isHost) return;
      try {
        await emitWithAck('game:rematch', { mode: 'swap_teams' });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  if (ui.pruneButton) {
    ui.pruneButton.addEventListener('click', async () => {
      try {
        const response = await emitWithAck('room:prune_disconnected', {});
        const removed = Number(response.removedCount || 0);
        showToast(removed > 0 ? t('removed_offline', { count: removed }) : t('no_offline_players'));
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  ui.hintForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const word = ui.hintWordInput.value.trim();
    const count = Number(ui.hintCountInput.value);
    const maxHintCount = getCurrentMaxHintCount(state.snapshot);
    if (!word) {
      showToast(t('hint_word_required'));
      return;
    }
    if (!Number.isInteger(count) || count < 0 || count > maxHintCount) {
      showToast(t('hint_count_range', { max: maxHintCount }));
      return;
    }
    if (ui.hintSubmitButton) ui.hintSubmitButton.classList.add('btn-loading');
    try {
      await emitWithAck('turn:hint_submit', { word, count });
      ui.hintWordInput.value = '';
      ui.hintCountInput.value = '1';
      state.spymasterSelections.clear();
    } catch (error) {
      showToast(translateServerError(error.message), 'error');
    } finally {
      if (ui.hintSubmitButton) ui.hintSubmitButton.classList.remove('btn-loading');
    }
  });

  ui.endTurnButton.addEventListener('click', async () => {
    try {
      await emitWithAck('turn:end', {});
    } catch (error) {
      showToast(error.message);
    }
  });

  if (ui.submitGuessButton) {
    ui.submitGuessButton.addEventListener('click', async () => {
      if (!state.snapshot) return;
      if (!canGuess(state.snapshot)) {
        showToast(t('guessing_not_open'));
        return;
      }
      if (state.selectedGuessIndex === null) {
        showToast(t('select_card_before_guess'));
        return;
      }
      ui.submitGuessButton.classList.add('btn-loading');
      try {
        await submitGuess(state.selectedGuessIndex);
      } finally {
        ui.submitGuessButton.classList.remove('btn-loading');
      }
    });
  }

  // Board click (single click for mark/select, double click for guess)
  ui.board.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-card-index]');
    if (!button || !state.snapshot) return;
    if (event.detail > 1) return;
    const index = Number(button.dataset.cardIndex);
    if (!Number.isInteger(index)) return;

    const snap = state.snapshot;
    if (handleSpymasterPlanning(snap, index)) return;
    handleOperativeSelect(snap, index);
    await handleMarkToggle(snap, index);
  });

  ui.board.addEventListener('dblclick', async (event) => {
    const button = event.target.closest('[data-card-index]');
    if (!button || !state.snapshot) return;
    if (!canGuess(state.snapshot)) return;
    const index = Number(button.dataset.cardIndex);
    if (!Number.isInteger(index)) return;
    const card = state.snapshot.game?.board?.[index];
    if (!card || card.revealed) return;
    await submitGuess(index);
  });

  // GG Button (Wave 6.1)
  if (ui.ggButton) {
    ui.ggButton.addEventListener('click', async () => {
      try {
        await emitWithAck('game:gg', {});
        playSound('gg');
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  // Debrief Button (Wave 10.1)
  if (ui.debriefButton) {
    ui.debriefButton.addEventListener('click', () => {
      const snapshot = state.snapshot;
      if (!snapshot?.game) return;
      const narrative = generateDebriefNarrative(snapshot.game.history, snapshot.players, snapshot.game.board);
      if (ui.debriefContent) ui.debriefContent.innerHTML = narrative;
      if (ui.debriefOverlay) ui.debriefOverlay.classList.remove('hidden');
    });
  }

  if (ui.debriefCloseButton) {
    ui.debriefCloseButton.addEventListener('click', () => {
      if (ui.debriefOverlay) ui.debriefOverlay.classList.add('hidden');
    });
  }

  // Analyst Review (Wave 10.2) — AI-powered postgame analysis
  if (ui.analystButton) {
    ui.analystButton.addEventListener('click', async () => {
      const snapshot = state.snapshot;
      if (!snapshot?.game) return;
      if (!state.aiAvailable) {
        showToast(t('analyst_unavailable'));
        return;
      }
      ui.analystButton.disabled = true;
      ui.analystButton.textContent = '...';
      try {
        const resp = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            history: snapshot.game.history || [],
            board: snapshot.game.board || [],
            players: snapshot.players || [],
          }),
        });
        const data = await resp.json();
        if (data.ok && data.analysis) {
          if (ui.debriefContent) {
            ui.debriefContent.innerHTML = `<h2>${t('analyst_review')}</h2><div class="analyst-text">${escapeHtml(data.analysis).replace(/\n/g, '<br>')}</div>`;
          }
          if (ui.debriefOverlay) ui.debriefOverlay.classList.remove('hidden');
        } else {
          showToast(data.error || t('analyst_unavailable'));
        }
      } catch (_err) {
        showToast(t('analyst_unavailable'));
      } finally {
        ui.analystButton.disabled = false;
        ui.analystButton.textContent = t('analyst_review');
      }
    });
  }

  // Sound toggle (Wave 4.4)
  if (ui.soundToggleButton) {
    ui.soundToggleButton.addEventListener('click', () => {
      const engine = window._taccanSoundEngine;
      if (engine?.SoundEngine) engine.SoundEngine.toggleMute();
    });
  }

  // Colorblind toggle (Wave 7.2)
  if (ui.colorblindToggleButton) {
    ui.colorblindToggleButton.addEventListener('click', () => {
      state.colorblindMode = !state.colorblindMode;
      document.body.classList.toggle('colorblind-mode', state.colorblindMode);
      try { localStorage.setItem('taccan.colorblind.v1', state.colorblindMode ? '1' : '0'); } catch (_e) {}
      if (ui.colorblindToggleButton) {
        ui.colorblindToggleButton.textContent = state.colorblindMode ? t('colorblind_on') : t('colorblind_off');
      }
    });
  }

  // Word Pack (Wave 8.4)
  if (ui.wordPackButton && ui.wordPackInput) {
    ui.wordPackButton.addEventListener('click', async () => {
      const url = ui.wordPackInput.value.trim();
      if (!url) return;
      try {
        await emitWithAck('room:word_pack_set', { url });
        showToast(t('word_pack_loaded'));
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  // Scratchpad init
  initScratchpad();
}

function handleSpymasterPlanning(snap, index) {
  const game = snap.game;
  if (!game || game.phase !== 'hint' || snap.me.role !== 'spymaster' || snap.me.team !== game.currentTeam) {
    return false;
  }
  const card = game.board?.[index];
  if (!card || card.revealed) return false;
  if (state.spymasterSelections.has(index)) {
    state.spymasterSelections.delete(index);
  } else {
    state.spymasterSelections.add(index);
  }
  if (ui.hintCountInput && state.spymasterSelections.size > 0) {
    ui.hintCountInput.value = String(state.spymasterSelections.size);
  }
  render();
  triggerHaptic('cardSelect');
  playSound('mark');
  return true;
}

function handleOperativeSelect(snap, index) {
  if (!canGuess(snap)) return;
  setSelectedGuess(index);
  renderSelectedGuess(snap);
  triggerHaptic('cardSelect');
  playSound('mark');
}

async function handleMarkToggle(snap, index) {
  if (!canMark(snap, index)) return;
  const board = snap.game?.board;
  if (board && board[index] && !board[index].revealed) {
    const marks = board[index].marks || [];
    const myId = snap.me.sessionId;
    const alreadyMarked = marks.findIndex(m => m.sessionId === myId);
    if (alreadyMarked >= 0) {
      board[index].marks.splice(alreadyMarked, 1);
    } else {
      board[index].marks.push({
        sessionId: myId,
        name: snap.me.name,
        team: snap.me.team,
      });
    }
    render();
  }
  try {
    await emitWithAck('turn:mark_toggle', { index });
  } catch (error) {
    showToast(error.message);
  }
}

async function submitGuess(index) {
  try {
    triggerHaptic('cardSelect');
    await emitWithAck('turn:guess', { index });
    setSelectedGuess(null);
  } catch (error) {
    showToast(error.message);
  }
}

function setSelectedGuess(index) {
  if (!Number.isInteger(index) || index < 0 || index > 24) {
    state.selectedGuessIndex = null;
    return;
  }
  state.selectedGuessIndex = index;
}

function getRoomUrl(code) {
  return `${window.location.origin}/room/${code}`;
}

function onRoomJoined(code) {
  renderQRCode(code);
  renderRoomSeal(code);
}
