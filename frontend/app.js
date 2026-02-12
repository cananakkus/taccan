const socket = io();

const STORAGE_KEY = 'taccan.session.v1';
const THEME_STORAGE_KEY = 'taccan.theme.v1';
const SCENE_CLASSES = [
  'scene-lobby',
  'scene-hint-red',
  'scene-hint-blue',
  'scene-guess-red',
  'scene-guess-blue',
  'scene-finished',
];
const state = {
  snapshot: null,
  toastTimer: null,
  rejoinAttempted: false,
  revealedCardIndexes: new Set(),
  activeGameId: null,
};

const ui = {
  appShell: document.querySelector('.app-shell'),
  connectionDot: document.getElementById('connection-dot'),
  connectionLabel: document.getElementById('connection-label'),
  themeToggle: document.getElementById('theme-toggle'),
  spectatorButton: document.querySelector('.spectator-btn[data-role="spectator"]'),
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
  redTeamList: document.getElementById('red-team-list'),
  blueTeamList: document.getElementById('blue-team-list'),
  startGameButton: document.getElementById('start-game-btn'),
  redCount: document.getElementById('red-count'),
  blueCount: document.getElementById('blue-count'),
  hintSection: document.getElementById('hint-section'),
  hintStatus: document.getElementById('hint-status'),
  hintForm: document.getElementById('hint-form'),
  hintWordInput: document.getElementById('hint-word-input'),
  hintCountInput: document.getElementById('hint-count-input'),
  hintSubmitButton: document.querySelector('#hint-form button[type=\"submit\"]'),
  guessSection: document.getElementById('guess-section'),
  hintDisplay: document.getElementById('hint-display'),
  guessNote: document.getElementById('guess-note'),
  endTurnButton: document.getElementById('end-turn-btn'),
  resultSection: document.getElementById('result-section'),
  resultText: document.getElementById('result-text'),
  board: document.getElementById('board'),
  toast: document.getElementById('toast'),
  teamButtons: [...document.querySelectorAll('[data-team]')],
  roleButtons: [...document.querySelectorAll('[data-role]')],
};

initTheme();
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
  if (ui.themeToggle) {
    ui.themeToggle.addEventListener('click', () => {
      const currentTheme = document.body.dataset.theme === 'dark' ? 'dark' : 'light';
      setTheme(currentTheme === 'dark' ? 'light' : 'dark', true);
    });
  }

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
      if (!state.snapshot) {
        showToast('Join or create a room first.');
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
        showToast('Join or create a room first.');
        return;
      }

      const role = button.dataset.role;
      const roleTeam = button.dataset.roleTeam;
      if (!role) {
        return;
      }

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

    if (event.detail > 1) {
      return;
    }

    const index = Number(button.dataset.cardIndex);
    if (!Number.isInteger(index)) {
      return;
    }

    if (!canMark(state.snapshot, index)) {
      return;
    }

    try {
      await emitWithAck('turn:mark_toggle', { index });
    } catch (error) {
      showToast(error.message);
    }
  });

  ui.board.addEventListener('dblclick', async (event) => {
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

    const card = state.snapshot.game?.board?.[index];
    if (!card || card.revealed) {
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

function canMark(snapshot, index) {
  if (!canGuess(snapshot)) {
    return false;
  }

  const card = snapshot.game?.board?.[index];
  return Boolean(card && !card.revealed);
}

function render() {
  const snapshot = state.snapshot;

  if (!snapshot) {
    if (ui.appShell) {
      ui.appShell.classList.remove('room-active');
    }

    for (const button of ui.teamButtons) {
      button.classList.remove('active');
    }
    for (const button of ui.roleButtons) {
      button.classList.remove('active');
    }
    if (ui.startGameButton) {
      ui.startGameButton.classList.add('hidden');
      ui.startGameButton.disabled = true;
    }
    if (ui.spectatorButton) {
      ui.spectatorButton.classList.add('hidden');
    }

    setSceneClass('scene-lobby');
    state.revealedCardIndexes = new Set();
    state.activeGameId = null;
    ui.joinPanel.classList.remove('hidden');
    ui.roomPanel.classList.add('hidden');
    ui.board.innerHTML = '';
    return;
  }

  if (ui.appShell) {
    ui.appShell.classList.add('room-active');
  }
  ui.joinPanel.classList.add('hidden');
  ui.roomPanel.classList.remove('hidden');

  ui.roomCode.textContent = snapshot.room.code;
  renderTeamBoxes(snapshot);
  renderControls(snapshot);
  renderGame(snapshot);
  renderScene(snapshot);
}

function renderTeamBoxes(snapshot) {
  const me = snapshot.me;
  ui.redTeamList.innerHTML = '';
  ui.blueTeamList.innerHTML = '';

  for (const player of snapshot.players) {
    const targetList = player.team === 'red' ? ui.redTeamList : player.team === 'blue' ? ui.blueTeamList : null;
    if (!targetList) {
      continue;
    }

    const item = buildTeamPlayerItem(player, me);
    targetList.appendChild(item);
  }

  fillEmptyTeamList(ui.redTeamList, 'No red agents yet');
  fillEmptyTeamList(ui.blueTeamList, 'No blue agents yet');
}

function buildTeamPlayerItem(player, me) {
  const item = document.createElement('li');
  item.className = 'team-player-item';

  const name = document.createElement('div');
  name.className = 'team-player-name';
  name.textContent = player.sessionId === me.sessionId ? `${player.name} (You)` : player.name;
  item.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'player-meta';

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

  item.appendChild(meta);
  return item;
}

function fillEmptyTeamList(list, text) {
  if (!list || list.childElementCount > 0) {
    return;
  }

  const item = document.createElement('li');
  item.className = 'team-empty';
  item.textContent = text;
  list.appendChild(item);
}

function renderControls(snapshot) {
  const gameActive = snapshot.game && snapshot.game.phase !== 'finished';

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
  ui.startGameButton.disabled = Boolean(gameActive);
  if (ui.spectatorButton) {
    ui.spectatorButton.classList.remove('hidden');
  }
}

function renderGame(snapshot) {
  const game = snapshot.game;
  setTurnBannerStyle(game);

  if (!game) {
    ui.turnBanner.textContent = 'Lobby open. Assign teams and roles, then host starts the game.';
    ui.redCount.textContent = 'Red: -';
    ui.blueCount.textContent = 'Blue: -';
    ui.hintSection.classList.add('hidden');
    ui.guessSection.classList.add('hidden');
    ui.resultSection.classList.add('hidden');
    ui.board.innerHTML = '';
    state.revealedCardIndexes = new Set();
    state.activeGameId = null;
    return;
  }

  if (game.id && state.activeGameId !== game.id) {
    state.activeGameId = game.id;
    state.revealedCardIndexes = new Set();
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

  const hintInteractive = canHint(snapshot);
  const guessInteractive = canGuess(snapshot);

  ui.hintSection.classList.remove('hidden');
  ui.guessSection.classList.remove('hidden');
  ui.hintSection.classList.toggle('locked', !hintInteractive);
  ui.guessSection.classList.toggle('locked', !guessInteractive);

  ui.hintWordInput.disabled = !hintInteractive;
  ui.hintCountInput.disabled = !hintInteractive;
  if (ui.hintSubmitButton) {
    ui.hintSubmitButton.disabled = !hintInteractive;
  }
  ui.endTurnButton.disabled = !guessInteractive;

  if (ui.hintStatus) {
    if (hintInteractive) {
      ui.hintStatus.textContent = 'Your turn. Send a one-word hint and number.';
    } else if (game.phase === 'finished') {
      ui.hintStatus.textContent = 'Game finished. Start a new round from the host panel.';
    } else if (game.phase !== 'hint') {
      ui.hintStatus.textContent = `${formatTeam(game.currentTeam)} operatives are currently guessing.`;
    } else {
      ui.hintStatus.textContent = `${formatTeam(game.currentTeam)} spymaster is locked in for this hint.`;
    }
  }

  if (game.hint) {
    const remaining =
      game.guessesRemaining === null ? 'unlimited' : String(Math.max(game.guessesRemaining, 0));
    ui.hintDisplay.textContent = `Hint: ${game.hint.word.toUpperCase()} ${game.hint.count} | guesses left: ${remaining}`;
  } else {
    ui.hintDisplay.textContent = 'Awaiting hint...';
  }

  if (ui.guessNote) {
    if (guessInteractive) {
      ui.guessNote.textContent = 'Click to mark suspects for everyone. Double-click to submit a guess.';
    } else if (game.phase === 'finished') {
      ui.guessNote.textContent = 'Board is closed. Review results and start another round.';
    } else if (game.phase !== 'guess') {
      ui.guessNote.textContent = 'Shared marks and guesses unlock once a hint is submitted.';
    } else {
      ui.guessNote.textContent = 'Only active-team operatives can mark and submit guesses.';
    }
  }

  const revealedNow = new Set();
  ui.board.innerHTML = '';
  for (const card of game.board) {
    const cardButton = document.createElement('button');
    cardButton.type = 'button';
    cardButton.className = 'card';
    cardButton.dataset.cardIndex = String(card.index);
    cardButton.style.setProperty('--card-tilt', getCardTilt(card.index));

    const word = document.createElement('span');
    word.className = 'card-word';
    word.textContent = card.word;
    cardButton.appendChild(word);

    if (card.revealed) {
      revealedNow.add(card.index);
      cardButton.classList.add('revealed', card.color);
      if (!state.revealedCardIndexes.has(card.index)) {
        cardButton.classList.add('fresh-reveal');
      }
      cardButton.disabled = true;
    } else {
      if (card.color) {
        cardButton.classList.add('keycard', card.color);
      }

      if (Array.isArray(card.marks) && card.marks.length > 0) {
        cardButton.classList.add('marked');

        const markerNames = card.marks.map((mark) => mark.name);
        cardButton.title = `Marked by: ${markerNames.join(', ')}`;

        const markers = document.createElement('div');
        markers.className = 'card-markers';

        for (const mark of card.marks) {
          const chip = document.createElement('span');
          chip.className = `card-marker ${mark.team === 'red' ? 'red' : mark.team === 'blue' ? 'blue' : 'neutral'}`;
          chip.textContent = truncateMarkerName(mark.name);
          chip.title = `${mark.name} (${mark.team})`;
          markers.appendChild(chip);
        }

        cardButton.appendChild(markers);
      }

      if (guessInteractive) {
        cardButton.classList.add('clickable');
      } else {
        cardButton.disabled = true;
      }
    }

    ui.board.appendChild(cardButton);
  }

  state.revealedCardIndexes = revealedNow;
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

function truncateMarkerName(name) {
  const normalized = String(name || '').trim();
  if (!normalized) {
    return 'Anon';
  }

  const maxLength = 11;
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function setConnection(isOnline, label) {
  ui.connectionLabel.textContent = label;
  ui.connectionDot.classList.toggle('online', isOnline);
  ui.connectionDot.classList.toggle('offline', !isOnline);
}

function initTheme() {
  const persistedTheme = readTheme();
  if (persistedTheme) {
    setTheme(persistedTheme, false);
    return;
  }

  const prefersDark =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches;
  setTheme(prefersDark ? 'dark' : 'light', false);
}

function setTheme(theme, persist) {
  const normalizedTheme = theme === 'dark' ? 'dark' : 'light';
  document.body.dataset.theme = normalizedTheme;

  if (ui.themeToggle) {
    ui.themeToggle.textContent = normalizedTheme === 'dark' ? 'Light Mode' : 'Dark Mode';
  }

  if (persist) {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, normalizedTheme);
    } catch (_error) {
      // Ignore storage errors (e.g. private mode restrictions).
    }
  }
}

function readTheme() {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark') {
      return value;
    }
    return null;
  } catch (_error) {
    return null;
  }
}

function setTurnBannerStyle(game) {
  ui.turnBanner.classList.remove('red', 'blue', 'finished');

  if (!game) {
    return;
  }

  if (game.phase === 'finished') {
    ui.turnBanner.classList.add('finished');
    return;
  }

  ui.turnBanner.classList.add(game.currentTeam === 'red' ? 'red' : 'blue');
}

function renderScene(snapshot) {
  const game = snapshot.game;

  if (!game) {
    setSceneClass('scene-lobby');
    return;
  }

  if (game.phase === 'finished') {
    setSceneClass('scene-finished');
    return;
  }

  setSceneClass(`scene-${game.phase}-${game.currentTeam}`);
}

function setSceneClass(nextClass) {
  document.body.classList.remove(...SCENE_CLASSES);
  document.body.classList.add(nextClass);
}

function getCardTilt(index) {
  const wobble = ((index % 2) - 0.5) * 0.08;
  return `${wobble.toFixed(2)}deg`;
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
