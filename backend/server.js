const path = require('path');
const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const words = require('./words');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer);

const PORT = Number(process.env.PORT) || 3000;
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM_VALUES = new Set(['red', 'blue', 'none']);
const ROLE_VALUES = new Set(['spymaster', 'operative', 'spectator']);
const PLAYER_NAME_MAX = 24;
const DISCONNECTED_PLAYER_TTL_MS = 45 * 60 * 1000;
const STALE_ROOM_TTL_MS = 8 * 60 * 60 * 1000;

/** @type {Map<string, Room>} */
const rooms = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, now: new Date().toISOString(), roomCount: rooms.size });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    res.status(404).json({ ok: false, error: 'Room not found.' });
    return;
  }

  const connectedPlayers = getSortedPlayers(room).filter((player) => player.connected).length;
  res.json({
    ok: true,
    room: {
      code: room.code,
      status: deriveRoomStatus(room),
      playerCount: room.players.size,
      connectedPlayers,
      hasActiveGame: Boolean(room.game && room.game.phase !== 'finished'),
    },
  });
});

io.on('connection', (socket) => {
  socket.emit('server:ready', { now: Date.now() });

  socket.on('room:create', (payload = {}, callback) => {
    leaveBoundRoom(socket);

    const player = createPlayer(payload.name, socket.id);
    const code = createRoomCode();

    const room = {
      code,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      hostSessionId: player.sessionId,
      players: new Map([[player.sessionId, player]]),
      game: null,
    };

    rooms.set(code, room);
    bindSocketToPlayer(socket, room, player);
    emitStateToRoom(room);

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId });
  });

  socket.on('room:join', (payload = {}, callback) => {
    const code = String(payload.code || '').toUpperCase().trim();

    if (!code) {
      ackError(callback, 'Room code is required.');
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      ackError(callback, 'Room not found.');
      return;
    }

    if (room.players.size >= 20) {
      ackError(callback, 'Room is full.');
      return;
    }

    leaveBoundRoom(socket);

    const player = createPlayer(payload.name, socket.id);
    room.players.set(player.sessionId, player);
    room.lastActiveAt = Date.now();

    bindSocketToPlayer(socket, room, player);
    emitStateToRoom(room);

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId });
  });

  socket.on('room:rejoin', (payload = {}, callback) => {
    const code = String(payload.code || '').toUpperCase().trim();
    const sessionId = String(payload.sessionId || '').trim();

    if (!code || !sessionId) {
      ackError(callback, 'Room code and session are required.');
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      ackError(callback, 'Room not found.');
      return;
    }

    const player = room.players.get(sessionId);
    if (!player) {
      ackError(callback, 'Session not found in room.');
      return;
    }

    leaveBoundRoom(socket);
    room.players.set(player.sessionId, player);

    if (payload.name) {
      player.name = sanitizeName(payload.name);
    }

    if (player.socketId && player.socketId !== socket.id) {
      const staleSocket = io.sockets.sockets.get(player.socketId);
      if (staleSocket) {
        staleSocket.emit('server:info', { message: 'This session was reconnected from another tab.' });
        staleSocket.disconnect(true);
      }
    }

    bindSocketToPlayer(socket, room, player);
    emitStateToRoom(room);

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId });
  });

  socket.on('room:leave', (_payload = {}, callback) => {
    const context = getContext(socket, 'room:leave');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    removePlayerFromRoom(context.room, context.player.sessionId);
    clearSocketBinding(socket);

    ackOk(callback, { left: true });
  });

  socket.on('team:set', (payload = {}, callback) => {
    const context = getContext(socket, 'team:set');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (isGameActive(context.room)) {
      sendViolation(socket, 'team:set', 'Team changes are locked while a game is active.');
      ackError(callback, 'Team changes are locked while a game is active.');
      return;
    }

    const team = String(payload.team || '').toLowerCase().trim();
    if (!TEAM_VALUES.has(team)) {
      ackError(callback, 'Invalid team value.');
      return;
    }

    const previousTeam = context.player.team;
    context.player.team = team;

    if (team === 'none') {
      context.player.role = 'spectator';
    } else if (previousTeam !== team && context.player.role === 'spymaster') {
      context.player.role = 'operative';
    } else if (context.player.role === 'spectator') {
      context.player.role = 'operative';
    }

    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);

    ackOk(callback, { team: context.player.team, role: context.player.role });
  });

  socket.on('role:set', (payload = {}, callback) => {
    const context = getContext(socket, 'role:set');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (isGameActive(context.room)) {
      sendViolation(socket, 'role:set', 'Role changes are locked while a game is active.');
      ackError(callback, 'Role changes are locked while a game is active.');
      return;
    }

    const role = String(payload.role || '').toLowerCase().trim();
    if (!ROLE_VALUES.has(role)) {
      ackError(callback, 'Invalid role value.');
      return;
    }

    if (role === 'spectator') {
      context.player.role = 'spectator';
      context.player.team = 'none';
    } else {
      if (context.player.team === 'none') {
        sendViolation(socket, 'role:set', 'Choose red or blue team before setting an active role.');
        ackError(callback, 'Choose red or blue team before setting an active role.');
        return;
      }

      if (role === 'spymaster') {
        const currentSpymaster = getSortedPlayers(context.room).find(
          (player) =>
            player.team === context.player.team &&
            player.role === 'spymaster' &&
            player.sessionId !== context.player.sessionId
        );

        if (currentSpymaster) {
          sendViolation(socket, 'role:set', `Team ${context.player.team} already has a spymaster.`);
          ackError(callback, `Team ${context.player.team} already has a spymaster.`);
          return;
        }
      }

      context.player.role = role;
    }

    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);

    ackOk(callback, { team: context.player.team, role: context.player.role });
  });

  socket.on('game:start', (_payload = {}, callback) => {
    const context = getContext(socket, 'game:start');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (context.room.hostSessionId !== context.player.sessionId) {
      sendViolation(socket, 'game:start', 'Only the host can start the game.');
      ackError(callback, 'Only the host can start the game.');
      return;
    }

    if (isGameActive(context.room)) {
      ackError(callback, 'A game is already running.');
      return;
    }

    const readinessError = validateRoomReadiness(context.room);
    if (readinessError) {
      sendViolation(socket, 'game:start', readinessError);
      ackError(callback, readinessError);
      return;
    }

    context.room.game = createGameState();
    context.room.lastActiveAt = Date.now();

    io.to(context.room.code).emit('game:started', {
      roomCode: context.room.code,
      startingTeam: context.room.game.startingTeam,
    });

    emitStateToRoom(context.room);
    ackOk(callback, { started: true });
  });

  socket.on('turn:hint_submit', (payload = {}, callback) => {
    const context = getContext(socket, 'turn:hint_submit');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const game = context.room.game;
    if (!game || game.phase === 'finished') {
      ackError(callback, 'No active game.');
      return;
    }

    if (game.phase !== 'hint') {
      sendViolation(socket, 'turn:hint_submit', 'Hints are closed. Wait for the next hint phase.');
      ackError(callback, 'Hints are closed. Wait for the next hint phase.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'spymaster') {
      sendViolation(socket, 'turn:hint_submit', 'Only the active team spymaster can submit a hint.');
      ackError(callback, 'Only the active team spymaster can submit a hint.');
      return;
    }

    const hintWord = normalizeHint(payload.word);
    const count = Number(payload.count);

    if (!hintWord) {
      ackError(callback, 'Hint must be a single alphabetical word.');
      return;
    }

    if (!Number.isInteger(count) || count < 0 || count > 9) {
      ackError(callback, 'Hint count must be an integer from 0 to 9.');
      return;
    }

    game.hint = {
      word: hintWord,
      count,
      team: context.player.team,
      by: context.player.sessionId,
      at: Date.now(),
    };
    game.phase = 'guess';
    game.guessesRemaining = count === 0 ? null : count + 1;
    game.history.push({
      type: 'hint',
      by: context.player.sessionId,
      team: context.player.team,
      word: hintWord,
      count,
      at: Date.now(),
    });
    game.lastActionAt = Date.now();

    io.to(context.room.code).emit('turn:hint_accepted', {
      team: game.currentTeam,
      hint: game.hint,
    });

    emitStateToRoom(context.room);
    ackOk(callback, { accepted: true });
  });

  socket.on('turn:guess', (payload = {}, callback) => {
    const context = getContext(socket, 'turn:guess');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const game = context.room.game;
    if (!game || game.phase === 'finished') {
      ackError(callback, 'No active game.');
      return;
    }

    if (game.phase !== 'guess') {
      sendViolation(socket, 'turn:guess', 'Guessing is not open right now.');
      ackError(callback, 'Guessing is not open right now.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
      sendViolation(socket, 'turn:guess', 'Only operatives on the active team may guess.');
      ackError(callback, 'Only operatives on the active team may guess.');
      return;
    }

    const index = Number(payload.index);
    if (!Number.isInteger(index) || index < 0 || index > 24) {
      ackError(callback, 'Card index must be between 0 and 24.');
      return;
    }

    const card = game.board[index];
    if (card.revealed) {
      ackError(callback, 'This card has already been revealed.');
      return;
    }

    const result = resolveGuess(game, context.player, card);
    context.room.lastActiveAt = Date.now();

    io.to(context.room.code).emit('turn:guess_resolved', {
      index: card.index,
      color: card.color,
      team: context.player.team,
      outcome: result.outcome,
      finished: game.phase === 'finished',
    });

    if (game.phase === 'finished') {
      io.to(context.room.code).emit('game:finished', {
        winner: game.winner,
        loser: game.loser,
        reason: game.reason,
      });
    } else if (result.endedTurn) {
      io.to(context.room.code).emit('turn:ended', {
        reason: result.turnEndReason || result.outcome,
        nextTeam: game.currentTeam,
      });
    }

    emitStateToRoom(context.room);
    ackOk(callback, result);
  });

  socket.on('turn:end', (_payload = {}, callback) => {
    const context = getContext(socket, 'turn:end');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const game = context.room.game;
    if (!game || game.phase === 'finished') {
      ackError(callback, 'No active game.');
      return;
    }

    if (game.phase !== 'guess') {
      ackError(callback, 'You can only end turn during guess phase.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
      sendViolation(socket, 'turn:end', 'Only active team operatives can end the turn.');
      ackError(callback, 'Only active team operatives can end the turn.');
      return;
    }

    advanceTurn(game, 'player_ended');
    context.room.lastActiveAt = Date.now();

    io.to(context.room.code).emit('turn:ended', {
      reason: 'player_ended',
      nextTeam: game.currentTeam,
    });

    emitStateToRoom(context.room);
    ackOk(callback, { ended: true });
  });

  socket.on('disconnect', () => {
    markDisconnected(socket);
  });
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    for (const player of room.players.values()) {
      if (!player.connected && now - player.lastSeenAt > DISCONNECTED_PLAYER_TTL_MS) {
        room.players.delete(player.sessionId);
      }
    }

    if (room.hostSessionId && !room.players.has(room.hostSessionId)) {
      const nextHost = getSortedPlayers(room)[0];
      room.hostSessionId = nextHost ? nextHost.sessionId : null;
    }

    if (room.players.size === 0 || now - room.lastActiveAt > STALE_ROOM_TTL_MS) {
      rooms.delete(room.code);
    }
  }
}, 60 * 1000).unref();

httpServer.listen(PORT, () => {
  console.log(`Taccan server listening on http://localhost:${PORT}`);
});

function sanitizeName(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, PLAYER_NAME_MAX);

  if (normalized) {
    return normalized;
  }

  return `Player-${Math.floor(Math.random() * 900 + 100)}`;
}

function normalizeHint(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (!/^[a-z][a-z-]*$/i.test(normalized)) {
    return null;
  }

  return normalized;
}

function createPlayer(name, socketId) {
  return {
    sessionId: randomUUID(),
    socketId,
    name: sanitizeName(name),
    team: 'none',
    role: 'spectator',
    connected: true,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
  };
}

function createRoomCode() {
  while (true) {
    let code = '';
    for (let i = 0; i < 4; i += 1) {
      code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
    }

    if (!rooms.has(code)) {
      return code;
    }
  }
}

function getOtherTeam(team) {
  return team === 'red' ? 'blue' : 'red';
}

function shuffle(items) {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }

  return items;
}

function sampleWords(count) {
  if (words.length < count) {
    throw new Error('Not enough words to generate board.');
  }

  const pool = shuffle([...words]);
  return pool.slice(0, count).map((word) => word.toUpperCase());
}

function createGameState() {
  const startingTeam = Math.random() < 0.5 ? 'red' : 'blue';
  const otherTeam = getOtherTeam(startingTeam);
  const colors = shuffle([
    ...new Array(9).fill(startingTeam),
    ...new Array(8).fill(otherTeam),
    ...new Array(7).fill('neutral'),
    'assassin',
  ]);

  const board = sampleWords(25).map((word, index) => ({
    index,
    word,
    color: colors[index],
    revealed: false,
    revealedBy: null,
  }));

  return {
    id: randomUUID(),
    createdAt: Date.now(),
    lastActionAt: Date.now(),
    phase: 'hint',
    currentTeam: startingTeam,
    startingTeam,
    turnNumber: 1,
    hint: null,
    guessesRemaining: 0,
    remaining: {
      red: startingTeam === 'red' ? 9 : 8,
      blue: startingTeam === 'blue' ? 9 : 8,
    },
    winner: null,
    loser: null,
    reason: null,
    board,
    history: [],
  };
}

function resolveGuess(game, player, card) {
  card.revealed = true;
  card.revealedBy = player.team;

  const opponentTeam = getOtherTeam(player.team);
  const result = {
    color: card.color,
    outcome: card.color,
    endedTurn: false,
    turnEndReason: null,
    finished: false,
  };

  game.history.push({
    type: 'guess',
    by: player.sessionId,
    team: player.team,
    index: card.index,
    color: card.color,
    at: Date.now(),
  });

  if (card.color === 'assassin') {
    finishGame(game, opponentTeam, player.team, 'assassin');
    result.finished = true;
    return result;
  }

  if (card.color === player.team) {
    game.remaining[player.team] -= 1;

    if (game.remaining[player.team] <= 0) {
      finishGame(game, player.team, opponentTeam, 'all_agents_revealed');
      result.finished = true;
      result.outcome = 'team_win';
      return result;
    }

    if (game.guessesRemaining !== null) {
      game.guessesRemaining -= 1;
      if (game.guessesRemaining <= 0) {
        advanceTurn(game, 'guess_limit_reached');
        result.endedTurn = true;
        result.turnEndReason = 'guess_limit_reached';
      }
    }

    return result;
  }

  if (card.color === opponentTeam) {
    game.remaining[opponentTeam] -= 1;

    if (game.remaining[opponentTeam] <= 0) {
      finishGame(game, opponentTeam, player.team, 'opponent_agents_revealed');
      result.finished = true;
      result.outcome = 'opponent_win';
      return result;
    }

    advanceTurn(game, 'opponent_card');
    result.endedTurn = true;
    result.turnEndReason = 'opponent_card';
    return result;
  }

  advanceTurn(game, 'neutral_card');
  result.endedTurn = true;
  result.turnEndReason = 'neutral_card';
  return result;
}

function advanceTurn(game, reason) {
  game.history.push({
    type: 'turn_end',
    reason,
    endedAt: Date.now(),
    previousTeam: game.currentTeam,
  });

  game.currentTeam = getOtherTeam(game.currentTeam);
  game.phase = 'hint';
  game.turnNumber += 1;
  game.hint = null;
  game.guessesRemaining = 0;
  game.lastActionAt = Date.now();
}

function finishGame(game, winner, loser, reason) {
  game.phase = 'finished';
  game.winner = winner;
  game.loser = loser;
  game.reason = reason;
  game.guessesRemaining = 0;
  game.lastActionAt = Date.now();

  game.history.push({
    type: 'game_end',
    winner,
    loser,
    reason,
    at: Date.now(),
  });
}

function validateRoomReadiness(room) {
  const connectedPlayers = getSortedPlayers(room).filter((player) => player.connected);

  for (const team of ['red', 'blue']) {
    const spymasters = connectedPlayers.filter(
      (player) => player.team === team && player.role === 'spymaster'
    );
    const operatives = connectedPlayers.filter(
      (player) => player.team === team && player.role === 'operative'
    );

    if (spymasters.length !== 1) {
      return `Team ${team} must have exactly one connected spymaster.`;
    }

    if (operatives.length < 1) {
      return `Team ${team} must have at least one connected operative.`;
    }
  }

  return null;
}

function isGameActive(room) {
  return Boolean(room.game && room.game.phase !== 'finished');
}

function deriveRoomStatus(room) {
  if (!room.game) {
    return 'lobby';
  }

  if (room.game.phase === 'finished') {
    return 'finished';
  }

  return 'in_game';
}

function buildStateForPlayer(room, viewer) {
  const game = room.game ? buildGameView(room.game, viewer) : null;

  return {
    now: Date.now(),
    room: {
      code: room.code,
      status: deriveRoomStatus(room),
      hostSessionId: room.hostSessionId,
      createdAt: room.createdAt,
    },
    me: {
      sessionId: viewer.sessionId,
      name: viewer.name,
      team: viewer.team,
      role: viewer.role,
      connected: viewer.connected,
      isHost: room.hostSessionId === viewer.sessionId,
    },
    players: getSortedPlayers(room).map((player) => ({
      sessionId: player.sessionId,
      name: player.name,
      team: player.team,
      role: player.role,
      connected: player.connected,
      joinedAt: player.joinedAt,
      isHost: room.hostSessionId === player.sessionId,
    })),
    game,
  };
}

function buildGameView(game, viewer) {
  const showKeycard = viewer.role === 'spymaster' || game.phase === 'finished';

  return {
    phase: game.phase,
    currentTeam: game.currentTeam,
    startingTeam: game.startingTeam,
    turnNumber: game.turnNumber,
    hint: game.hint,
    guessesRemaining: game.guessesRemaining,
    remaining: game.remaining,
    winner: game.winner,
    loser: game.loser,
    reason: game.reason,
    showKeycard,
    board: game.board.map((card) => ({
      index: card.index,
      word: card.word,
      revealed: card.revealed,
      revealedBy: card.revealed ? card.revealedBy : null,
      color: card.revealed || showKeycard ? card.color : null,
    })),
  };
}

function emitStateToRoom(room) {
  for (const player of room.players.values()) {
    if (!player.connected || !player.socketId) {
      continue;
    }

    const socket = io.sockets.sockets.get(player.socketId);
    if (!socket) {
      continue;
    }

    socket.emit('state:full', buildStateForPlayer(room, player));
  }
}

function getContext(socket, action) {
  const roomCode = socket.data.roomCode;
  const sessionId = socket.data.sessionId;

  if (!roomCode || !sessionId) {
    sendViolation(socket, action, 'You are not currently in a room.');
    return null;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    sendViolation(socket, action, 'Room no longer exists.');
    clearSocketBinding(socket);
    return null;
  }

  const player = room.players.get(sessionId);
  if (!player) {
    sendViolation(socket, action, 'Player session is not part of this room.');
    clearSocketBinding(socket);
    return null;
  }

  return { room, player };
}

function bindSocketToPlayer(socket, room, player) {
  if (player.socketId && player.socketId !== socket.id) {
    const existingSocket = io.sockets.sockets.get(player.socketId);
    if (existingSocket) {
      clearSocketBinding(existingSocket);
    }
  }

  player.socketId = socket.id;
  player.connected = true;
  player.lastSeenAt = Date.now();
  room.lastActiveAt = Date.now();

  socket.data.roomCode = room.code;
  socket.data.sessionId = player.sessionId;
  socket.join(room.code);
}

function clearSocketBinding(socket) {
  if (socket.data.roomCode) {
    socket.leave(socket.data.roomCode);
  }

  socket.data.roomCode = null;
  socket.data.sessionId = null;
}

function leaveBoundRoom(socket) {
  const roomCode = socket.data.roomCode;
  const sessionId = socket.data.sessionId;

  if (!roomCode || !sessionId) {
    return;
  }

  const room = rooms.get(roomCode);
  if (room) {
    const player = room.players.get(sessionId);
    if (player && player.socketId === socket.id) {
      removePlayerFromRoom(room, sessionId);
    }
  }

  clearSocketBinding(socket);
}

function markDisconnected(socket) {
  const roomCode = socket.data.roomCode;
  const sessionId = socket.data.sessionId;

  if (!roomCode || !sessionId) {
    return;
  }

  const room = rooms.get(roomCode);
  if (!room) {
    clearSocketBinding(socket);
    return;
  }

  const player = room.players.get(sessionId);
  if (!player) {
    clearSocketBinding(socket);
    return;
  }

  if (player.socketId === socket.id) {
    player.connected = false;
    player.socketId = null;
    player.lastSeenAt = Date.now();
    room.lastActiveAt = Date.now();

    emitStateToRoom(room);
  }

  clearSocketBinding(socket);
}

function removePlayerFromRoom(room, sessionId) {
  room.players.delete(sessionId);
  room.lastActiveAt = Date.now();

  if (room.hostSessionId === sessionId) {
    const nextHost = getSortedPlayers(room)[0];
    room.hostSessionId = nextHost ? nextHost.sessionId : null;
  }

  if (room.players.size === 0) {
    rooms.delete(room.code);
    return;
  }

  emitStateToRoom(room);
}

function getSortedPlayers(room) {
  return [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

function sendViolation(socket, action, message) {
  socket.emit('error:rule_violation', { action, message });
}

function ackOk(callback, payload = {}) {
  if (typeof callback === 'function') {
    callback({ ok: true, ...payload });
  }
}

function ackError(callback, error) {
  if (typeof callback === 'function') {
    callback({ ok: false, error });
  }
}

/**
 * @typedef {'red' | 'blue' | 'neutral' | 'assassin'} CardColor
 *
 * @typedef {Object} Card
 * @property {number} index
 * @property {string} word
 * @property {CardColor} color
 * @property {boolean} revealed
 * @property {'red' | 'blue' | null} revealedBy
 *
 * @typedef {Object} Player
 * @property {string} sessionId
 * @property {string | null} socketId
 * @property {string} name
 * @property {'red' | 'blue' | 'none'} team
 * @property {'spymaster' | 'operative' | 'spectator'} role
 * @property {boolean} connected
 * @property {number} joinedAt
 * @property {number} lastSeenAt
 *
 * @typedef {Object} GameState
 * @property {string} id
 * @property {number} createdAt
 * @property {number} lastActionAt
 * @property {'hint' | 'guess' | 'finished'} phase
 * @property {'red' | 'blue'} currentTeam
 * @property {'red' | 'blue'} startingTeam
 * @property {number} turnNumber
 * @property {Object | null} hint
 * @property {number | null} guessesRemaining
 * @property {{red: number, blue: number}} remaining
 * @property {'red' | 'blue' | null} winner
 * @property {'red' | 'blue' | null} loser
 * @property {string | null} reason
 * @property {Card[]} board
 * @property {Object[]} history
 *
 * @typedef {Object} Room
 * @property {string} code
 * @property {number} createdAt
 * @property {number} lastActiveAt
 * @property {string | null} hostSessionId
 * @property {Map<string, Player>} players
 * @property {GameState | null} game
 */
