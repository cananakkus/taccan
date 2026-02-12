const socket = io();

const STORAGE_KEY = 'taccan.session.v1';
const state = {
  snapshot: null,
  toastTimer: null,
  rejoinAttempted: false,
};

const ui = {
  connectionDot: document.getElementById('connection-dot'),
  connectionLabel: document.getElementById('connection-label'),
  joinPanel: document.getElementById('join-panel'),
  roomPanel: document.getElementById('room-panel'),
  nameInput: document.getElementById('name-input'),
  codeInput: document.getElementById('code-input'),
  joinButton: document.getElementById('join-btn'),
  createButton: document.getElementById('create-btn'),
  joinNote: document.getElementById('join-note'),
  roomCode: document.getElementById('room-code'),
  copyRoomButton: document.getElementById('copy-room-btn'),
  leaveRoomButton: document.getElementById('leave-room-btn'),
  turnBanner: document.getElementById('turn-banner'),
  playerList: document.getElementById('player-list'),
  startGameButton: document.getElementById('start-game-btn'),
  redCount: document.getElementById('red-count'),
  blueCount: document.getElementById('blue-count'),
  hintSection: document.getElementById('hint-section'),
  hintForm: document.getElementById('hint-form'),
  hintWordInput: document.getElementById('hint-word-input'),
  hintCountInput: document.getElementById('hint-count-input'),
  guessSection: document.getElementById('guess-section'),
  hintDisplay: document.getElementById('hint-display'),
  endTurnButton: document.getElementById('end-turn-btn'),
  resultSection: document.getElementById('result-section'),
  resultText: document.getElementById('result-text'),
  board: document.getElementById('board'),
  toast: document.getElementById('toast'),
  teamButtons: [...document.querySelectorAll('[data-team]')],
  roleButtons: [...document.querySelectorAll('[data-role]')],
};

wireSocketEvents();
wireUiEvents();
render();

function wireSocketEvents() {
  socket.on('connect', async () => {
    setConnection(true, 'Connected');
    await tryAutoRejoin();
  });

  socket.on('disconnect', () => {
    setConnection(false, 'Disconnected');
  });

  socket.on('state:full', (snapshot) => {
    state.snapshot = snapshot;
    writeSession({
      code: snapshot.room.code,
      sessionId: snapshot.me.sessionId,
      name: snapshot.me.name,
    });
    render();
  });

  socket.on('error:rule_violation', (payload = {}) => {
    showToast(payload.message || 'Action rejected by game rules.');
  });

  socket.on('server:info', (payload = {}) => {
    if (payload.message) {
      showToast(payload.message);
    }
  });

  socket.on('connect_error', () => {
    setConnection(false, 'Connection error');
  });
}

function wireUiEvents() {
  ui.createButton.addEventListener('click', async () => {
    const name = ui.nameInput.value.trim();
    if (!name) {
      showToast('Enter a display name before creating a room.');
      return;
    }

    try {
      const response = await emitWithAck('room:create', { name });
      writeSession({ code: response.roomCode, sessionId: response.sessionId, name });
      ui.codeInput.value = response.roomCode;
      ui.joinNote.textContent = 'Room created. Share the code with your group.';
    } catch (error) {
      showToast(error.message);
    }
  });

  ui.joinButton.addEventListener('click', async () => {
    const name = ui.nameInput.value.trim();
    const code = ui.codeInput.value.trim().toUpperCase();

    if (!name) {
      showToast('Enter a display name before joining.');
      return;
    }

    if (!code) {
      showToast('Enter a room code.');
      return;
    }

    try {
      const response = await emitWithAck('room:join', { code, name });
      writeSession({ code: response.roomCode, sessionId: response.sessionId, name });
      ui.codeInput.value = response.roomCode;
      ui.joinNote.textContent = `Joined room ${response.roomCode}.`;
    } catch (error) {
      showToast(error.message);
    }
  });

  ui.copyRoomButton.addEventListener('click', async () => {
    const snapshot = state.snapshot;
    if (!snapshot) {
      return;
    }

    try {
      await navigator.clipboard.writeText(snapshot.room.code);
      showToast('Room code copied.');
    } catch (_error) {
      showToast('Copy failed.');
    }
  });

  ui.leaveRoomButton.addEventListener('click', async () => {
    try {
      await emitWithAck('room:leave', {});
    } catch (_error) {
      // Ignore error and clear local view anyway.
    }

    clearSession();
    state.snapshot = null;
    render();
  });

  for (const button of ui.teamButtons) {
    button.addEventListener('click', async () => {
      try {
        await emitWithAck('team:set', { team: button.dataset.team });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  for (const button of ui.roleButtons) {
    button.addEventListener('click', async () => {
      try {
        await emitWithAck('role:set', { role: button.dataset.role });
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  ui.startGameButton.addEventListener('click', async () => {
    try {
      await emitWithAck('game:start', {});
    } catch (error) {
      showToast(error.message);
    }
  });

  ui.hintForm.addEventListener('submit', async (event) => {
    event.preventDefault();

    const word = ui.hintWordInput.value.trim();
    const count = Number(ui.hintCountInput.value);

    if (!word) {
      showToast('Hint word is required.');
      return;
    }

    try {
      await emitWithAck('turn:hint_submit', { word, count });
      ui.hintWordInput.value = '';
      ui.hintCountInput.value = '1';
    } catch (error) {
      showToast(error.message);
    }
  });

  ui.endTurnButton.addEventListener('click', async () => {
    try {
      await emitWithAck('turn:end', {});
    } catch (error) {
      showToast(error.message);
    }
  });

  ui.board.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-card-index]');
    if (!button || !state.snapshot) {
      return;
    }

    if (!canGuess(state.snapshot)) {
      return;
    }

    const index = Number(button.dataset.cardIndex);
    if (!Number.isInteger(index)) {
      return;
    }

    try {
      await emitWithAck('turn:guess', { index });
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function tryAutoRejoin() {
  if (state.rejoinAttempted) {
    return;
  }

  state.rejoinAttempted = true;
  const stored = readSession();

  if (!stored) {
    return;
  }

  ui.nameInput.value = stored.name || '';
  ui.codeInput.value = stored.code || '';

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

function canHint(snapshot) {
  return Boolean(
    snapshot.game &&
      snapshot.game.phase === 'hint' &&
      snapshot.me.role === 'spymaster' &&
      snapshot.me.team === snapshot.game.currentTeam
  );
}

function canGuess(snapshot) {
  return Boolean(
    snapshot.game &&
      snapshot.game.phase === 'guess' &&
      snapshot.me.role === 'operative' &&
      snapshot.me.team === snapshot.game.currentTeam
  );
}

function render() {
  const snapshot = state.snapshot;

  if (!snapshot) {
    ui.joinPanel.classList.remove('hidden');
    ui.roomPanel.classList.add('hidden');
    ui.board.innerHTML = '';
    return;
  }

  ui.joinPanel.classList.add('hidden');
  ui.roomPanel.classList.remove('hidden');

  ui.roomCode.textContent = snapshot.room.code;
  renderPlayers(snapshot);
  renderControls(snapshot);
  renderGame(snapshot);
}

function renderPlayers(snapshot) {
  const me = snapshot.me;
  ui.playerList.innerHTML = '';

  for (const player of snapshot.players) {
    const item = document.createElement('li');
    item.className = 'player-item';

    const left = document.createElement('div');
    const name = document.createElement('div');
    name.textContent = player.sessionId === me.sessionId ? `${player.name} (You)` : player.name;
    left.appendChild(name);

    const meta = document.createElement('div');
    meta.className = 'player-meta';

    const teamTag = document.createElement('span');
    teamTag.className = `tag ${player.team === 'none' ? 'spectator' : player.team}`;
    teamTag.textContent = player.team === 'none' ? 'spectator' : player.team;
    meta.appendChild(teamTag);

    const roleTag = document.createElement('span');
    roleTag.className = 'tag';
    roleTag.textContent = player.role;
    meta.appendChild(roleTag);

    if (player.isHost) {
      const hostTag = document.createElement('span');
      hostTag.className = 'tag host';
      hostTag.textContent = 'host';
      meta.appendChild(hostTag);
    }

    if (!player.connected) {
      const offlineTag = document.createElement('span');
      offlineTag.className = 'tag offline';
      offlineTag.textContent = 'offline';
      meta.appendChild(offlineTag);
    }

    left.appendChild(meta);
    item.appendChild(left);

    ui.playerList.appendChild(item);
  }
}

function renderControls(snapshot) {
  const gameActive = snapshot.game && snapshot.game.phase !== 'finished';

  for (const button of ui.teamButtons) {
    const isMine = button.dataset.team === snapshot.me.team;
    button.classList.toggle('active', isMine);
    button.disabled = gameActive;
  }

  for (const button of ui.roleButtons) {
    const isMine = button.dataset.role === snapshot.me.role;
    button.classList.toggle('active', isMine);
    const role = button.dataset.role;

    let disabled = gameActive;
    if (!disabled && (role === 'operative' || role === 'spymaster') && snapshot.me.team === 'none') {
      disabled = true;
    }

    button.disabled = disabled;
  }

  ui.startGameButton.classList.toggle('hidden', !snapshot.me.isHost);
  ui.startGameButton.disabled = Boolean(gameActive);
}

function renderGame(snapshot) {
  const game = snapshot.game;

  if (!game) {
    ui.turnBanner.textContent = 'Lobby open. Assign teams and roles, then host starts the game.';
    ui.redCount.textContent = 'Red: -';
    ui.blueCount.textContent = 'Blue: -';
    ui.hintSection.classList.add('hidden');
    ui.guessSection.classList.add('hidden');
    ui.resultSection.classList.add('hidden');
    ui.board.innerHTML = '';
    return;
  }

  ui.redCount.textContent = `Red: ${game.remaining.red}`;
  ui.blueCount.textContent = `Blue: ${game.remaining.blue}`;

  if (game.phase === 'finished') {
    ui.turnBanner.textContent = `Game over. ${formatTeam(game.winner)} team wins.`;
    ui.resultSection.classList.remove('hidden');
    ui.resultText.textContent = formatResultReason(game);
  } else if (game.phase === 'hint') {
    ui.turnBanner.textContent = `${formatTeam(game.currentTeam)} spymaster is choosing a hint.`;
    ui.resultSection.classList.add('hidden');
  } else {
    ui.turnBanner.textContent = `${formatTeam(game.currentTeam)} operatives are guessing.`;
    ui.resultSection.classList.add('hidden');
  }

  const hintVisible = canHint(snapshot);
  const guessVisible = canGuess(snapshot);

  ui.hintSection.classList.toggle('hidden', !hintVisible);
  ui.guessSection.classList.toggle('hidden', !guessVisible);

  if (game.hint) {
    const remaining =
      game.guessesRemaining === null ? 'unlimited' : String(Math.max(game.guessesRemaining, 0));
    ui.hintDisplay.textContent = `Hint: ${game.hint.word.toUpperCase()} ${game.hint.count} | guesses left: ${remaining}`;
  } else {
    ui.hintDisplay.textContent = 'Awaiting hint...';
  }

  ui.board.innerHTML = '';
  for (const card of game.board) {
    const cardButton = document.createElement('button');
    cardButton.type = 'button';
    cardButton.className = 'card';
    cardButton.dataset.cardIndex = String(card.index);
    cardButton.textContent = card.word;

    if (card.revealed) {
      cardButton.classList.add('revealed', card.color);
      cardButton.disabled = true;
    } else {
      if (card.color) {
        cardButton.classList.add('keycard', card.color);
      }

      if (guessVisible) {
        cardButton.classList.add('clickable');
      } else {
        cardButton.disabled = true;
      }
    }

    ui.board.appendChild(cardButton);
  }
}

function formatTeam(team) {
  if (team === 'red') {
    return 'Red';
  }

  if (team === 'blue') {
    return 'Blue';
  }

  return 'Unknown';
}

function formatResultReason(game) {
  if (game.reason === 'assassin') {
    return `${formatTeam(game.loser)} team revealed the assassin.`;
  }

  if (game.reason === 'all_agents_revealed') {
    return `${formatTeam(game.winner)} team found all of their agents.`;
  }

  if (game.reason === 'opponent_agents_revealed') {
    return `${formatTeam(game.winner)} team won because their final agent was revealed.`;
  }

  return `${formatTeam(game.winner)} team wins.`;
}

function setConnection(isOnline, label) {
  ui.connectionLabel.textContent = label;
  ui.connectionDot.classList.toggle('online', isOnline);
  ui.connectionDot.classList.toggle('offline', !isOnline);
}

function showToast(message) {
  ui.toast.textContent = message;
  ui.toast.classList.remove('hidden');

  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
  }

  state.toastTimer = setTimeout(() => {
    ui.toast.classList.add('hidden');
  }, 2400);
}

function readSession() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (!value) {
      return null;
    }

    const parsed = JSON.parse(value);
    if (!parsed || !parsed.code || !parsed.sessionId) {
      return null;
    }

    return parsed;
  } catch (_error) {
    return null;
  }
}

function writeSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function emitWithAck(event, payload) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
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
