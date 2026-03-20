const path = require('path');
const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const { validatePayload } = require('./payload-schema');
const { normalizeHint, createGameState, resolveGuess, advanceTurn } = require('./game-engine');
const {
  getSortedPlayers,
  getConnectedPlayerCount,
  getConnectedPlayersCountGlobal,
  ensureHostSession,
  pruneDisconnectedPlayers,
  getRoomReadinessError,
} = require('./room-utils');

const app = express();
const httpServer = http.createServer(app);
const CORS_ORIGIN = process.env.CORS_ORIGIN || 'https://play.wleeaf.dev';
const io = new Server(httpServer, {
  cors: { origin: CORS_ORIGIN === '*' ? true : CORS_ORIGIN.split(','), methods: ['GET', 'POST'] },
});

const PORT = Number(process.env.PORT) || 3000;
const HOST = String(process.env.HOST || '127.0.0.1');
const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEAM_VALUES = new Set(['red', 'blue', 'none']);
const ROLE_VALUES = new Set(['spymaster', 'operative', 'spectator']);
const PLAYER_NAME_MAX = 24;
const ROOM_CONNECTED_LIMIT = 20;
const DISCONNECTED_PLAYER_TTL_MS = 45 * 60 * 1000;
const STALE_ROOM_TTL_MS = 8 * 60 * 60 * 1000;
const ROOM_MODE_VALUES = new Set(['casual', 'blitz']);
const BLITZ_HINT_TIMER_MS_DEFAULT = Number(process.env.BLITZ_HINT_TIMER_MS) || 25_000;
const BLITZ_GUESS_TIMER_MS_DEFAULT = Number(process.env.BLITZ_GUESS_TIMER_MS) || 35_000;
const MODE_CONFIG = {
  casual: {
    hintTimerMs: null,
    guessTimerMs: null,
    maxHintCount: null,
  },
  blitz: {
    hintTimerMs: BLITZ_HINT_TIMER_MS_DEFAULT,
    guessTimerMs: BLITZ_GUESS_TIMER_MS_DEFAULT,
    maxHintCount: 9,
  },
};
const EVENT_RATE_LIMITS = {
  'room:create': { max: 8, windowMs: 30_000 },
  'room:join': { max: 12, windowMs: 30_000 },
  'room:rejoin': { max: 20, windowMs: 30_000 },
  'room:leave': { max: 20, windowMs: 30_000 },
  'room:prune_disconnected': { max: 8, windowMs: 30_000 },
  'room:mode_set': { max: 20, windowMs: 30_000 },
  'team:set': { max: 30, windowMs: 10_000 },
  'role:set': { max: 30, windowMs: 10_000 },
  'game:start': { max: 10, windowMs: 30_000 },
  'game:rematch': { max: 15, windowMs: 30_000 },
  'turn:hint_submit': { max: 30, windowMs: 30_000 },
  'turn:mark_toggle': { max: 80, windowMs: 10_000 },
  'turn:guess': { max: 40, windowMs: 10_000 },
  'turn:end': { max: 30, windowMs: 10_000 },
  'turn:mark_confidence': { max: 80, windowMs: 10_000 },
  'game:gg': { max: 3, windowMs: 30_000 },
  'game:mvp_vote': { max: 5, windowMs: 30_000 },
  'room:word_pack_set': { max: 5, windowMs: 60_000 },
  'voice:join': { max: 10, windowMs: 30_000 },
  'voice:leave': { max: 10, windowMs: 30_000 },
  'voice:signal': { max: 200, windowMs: 10_000 },
  'voice:mute': { max: 30, windowMs: 10_000 },
  'chat:send': { max: 10, windowMs: 10_000 },
  default: { max: 60, windowMs: 10_000 },
};
const metrics = {
  roomCreate: 0,
  roomJoin: 0,
  roomRejoin: 0,
  roomLeave: 0,
  roomPrune: 0,
  modeSet: 0,
  rematchStarted: 0,
  gameStart: 0,
  turnTimerStarted: 0,
  turnTimerExpired: 0,
  ruleViolation: 0,
  rateLimited: 0,
  disconnect: 0,
};

/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const phaseTimers = new Map();
/** @type {Map<string, NodeJS.Timeout>} */
const mvpTimers = new Map();

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'frontend'), {
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    now: new Date().toISOString(),
    roomCount: rooms.size,
    connectedPlayers: getConnectedPlayersCountGlobal(rooms),
    metrics,
  });
});

app.get('/api/rooms/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase();
  const room = rooms.get(code);

  if (!room) {
    res.status(404).json({ ok: false, error: 'Room not found.' });
    return;
  }

  const connectedPlayers = getConnectedPlayerCount(room);
  res.json({
    ok: true,
    room: {
      code: room.code,
      status: deriveRoomStatus(room),
      playerCount: room.players.size,
      connectedPlayers,
      mode: getRoomMode(room),
      hasActiveGame: Boolean(room.game && room.game.phase !== 'finished'),
      match: room.match
        ? {
            id: room.match.id,
            roundNumber: room.match.roundNumber,
          }
        : null,
    },
  });
});

app.use(express.json({ limit: '64kb' }));

// Shareable room links (Wave 2.3) — catch-all route serving index.html
app.get('/room/:code', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

io.on('connection', (socket) => {
  socket.data.rateBuckets = {};
  logEvent('socket_connected', { socketId: socket.id });
  socket.emit('server:ready', { now: Date.now() });

  socket.on('room:create', (payload = {}, callback) => {
    const action = 'room:create';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    leaveBoundRoom(socket);

    const player = createPlayer(validatedPayload.name, socket.id);
    const code = createRoomCode();

    const room = {
      code,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      hostSessionId: player.sessionId,
      players: new Map([[player.sessionId, player]]),
      mode: 'casual',
      match: null,
      game: null,
      chatMessages: [],
    };

    rooms.set(code, room);
    bindSocketToPlayer(socket, room, player);
    emitStateToRoom(room);
    metrics.roomCreate += 1;
    logEvent('room_created', { roomCode: room.code, by: player.sessionId });

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId });
  });

  socket.on('room:join', (payload = {}, callback) => {
    const action = 'room:join';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const code = String(validatedPayload.code || '').toUpperCase().trim();

    if (!code) {
      ackError(callback, 'Room code is required.');
      return;
    }

    const room = rooms.get(code);
    if (!room) {
      ackError(callback, 'Room not found.');
      return;
    }

    if (getConnectedPlayerCount(room) >= ROOM_CONNECTED_LIMIT) {
      ackError(callback, 'Room is full.');
      return;
    }

    leaveBoundRoom(socket);

    const player = createPlayer(validatedPayload.name, socket.id);
    room.players.set(player.sessionId, player);
    room.lastActiveAt = Date.now();
    ensureHostSession(room);

    bindSocketToPlayer(socket, room, player);
    emitStateToRoom(room);
    metrics.roomJoin += 1;
    logEvent('room_joined', { roomCode: room.code, sessionId: player.sessionId, connected: getConnectedPlayerCount(room) });

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId });
  });

  socket.on('room:rejoin', (payload = {}, callback) => {
    const action = 'room:rejoin';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const code = String(validatedPayload.code || '').toUpperCase().trim();
    const sessionId = String(validatedPayload.sessionId || '').trim();

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

    if (validatedPayload.name) {
      player.name = sanitizeName(validatedPayload.name);
    }

    if (player.socketId && player.socketId !== socket.id) {
      handleVoiceLeave(room, player);
      const staleSocket = io.sockets.sockets.get(player.socketId);
      if (staleSocket) {
        staleSocket.emit('server:info', { message: 'This session was reconnected from another tab.' });
        staleSocket.disconnect(true);
      }
    }

    bindSocketToPlayer(socket, room, player);
    ensureHostSession(room);
    emitStateToRoom(room);
    metrics.roomRejoin += 1;
    logEvent('room_rejoined', { roomCode: room.code, sessionId: player.sessionId });

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId });
  });

  socket.on('room:leave', (payload = {}, callback) => {
    const action = 'room:leave';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, 'room:leave');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    removePlayerFromRoom(context.room, context.player.sessionId);
    clearSocketBinding(socket);
    metrics.roomLeave += 1;
    logEvent('room_left', { roomCode: context.room.code, sessionId: context.player.sessionId });

    ackOk(callback, { left: true });
  });

  socket.on('room:prune_disconnected', (payload = {}, callback) => {
    const action = 'room:prune_disconnected';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (context.room.hostSessionId !== context.player.sessionId) {
      sendViolation(socket, action, 'Only the host can prune disconnected players.');
      ackError(callback, 'Only the host can prune disconnected players.');
      return;
    }

    const removedCount = pruneDisconnectedPlayers(
      context.room,
      Date.now(),
      DISCONNECTED_PLAYER_TTL_MS,
      clearMarksForSession,
      { force: true }
    );
    ensureHostSession(context.room);
    context.room.lastActiveAt = Date.now();

    if (context.room.players.size === 0) {
      clearPhaseTimerState(context.room);
      rooms.delete(context.room.code);
      ackOk(callback, { removedCount, deletedRoom: true });
      return;
    }

    emitStateToRoom(context.room);
    metrics.roomPrune += 1;
    logEvent('room_pruned', { roomCode: context.room.code, removedCount });
    ackOk(callback, { removedCount, deletedRoom: false });
  });

  socket.on('room:mode_set', (payload = {}, callback) => {
    const action = 'room:mode_set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (context.room.hostSessionId !== context.player.sessionId) {
      sendViolation(socket, action, 'Only the host can change room mode.');
      ackError(callback, 'Only the host can change room mode.');
      return;
    }

    if (isGameActive(context.room)) {
      ackError(callback, 'Cannot change room mode during an active game.');
      return;
    }

    const nextMode = getNormalizedMode(validatedPayload.mode);
    if (!ROOM_MODE_VALUES.has(nextMode)) {
      ackError(callback, 'Invalid room mode.');
      return;
    }

    if (getRoomMode(context.room) === nextMode) {
      ackOk(callback, { mode: nextMode, modeConfig: getModeConfig(nextMode, context.room) });
      return;
    }

    context.room.mode = nextMode;
    context.room.lastActiveAt = Date.now();
    metrics.modeSet += 1;

    emitStateToRoom(context.room);
    logEvent('room_mode_set', {
      roomCode: context.room.code,
      mode: nextMode,
      by: context.player.sessionId,
    });

    ackOk(callback, { mode: nextMode, modeConfig: getModeConfig(nextMode, context.room) });
  });

  socket.on('room:blitz_config', (payload = {}, callback) => {
    const action = 'room:blitz_config';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) { ackError(callback, 'You are not in a room.'); return; }
    if (context.room.hostSessionId !== context.player.sessionId) {
      ackError(callback, 'Only the host can change blitz settings.');
      return;
    }
    if (isGameActive(context.room)) {
      ackError(callback, 'Cannot change settings during an active game.');
      return;
    }

    const hintSec = validatedPayload.hintTimerSec;
    const guessSec = validatedPayload.guessTimerSec;
    context.room.blitzConfig = {
      hintTimerMs: hintSec * 1000,
      guessTimerMs: guessSec * 1000,
    };
    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);
    ackOk(callback, { blitzConfig: context.room.blitzConfig });
  });

  socket.on('team:set', (payload = {}, callback) => {
    const action = 'team:set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const team = String(validatedPayload.team || '').toLowerCase().trim();
    if (!TEAM_VALUES.has(team)) {
      ackError(callback, 'Invalid team value.');
      return;
    }

    context.player.team = team;

    if (team === 'none') {
      context.player.role = 'spectator';
    } else if (context.player.role === 'spectator') {
      context.player.role = 'operative';
    }

    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);

    ackOk(callback, { team: context.player.team, role: context.player.role });
  });

  socket.on('role:set', (payload = {}, callback) => {
    const action = 'role:set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const role = String(validatedPayload.role || '').toLowerCase().trim();
    if (!ROLE_VALUES.has(role)) {
      ackError(callback, 'Invalid role value.');
      return;
    }

    const previousTeam = context.player.team;
    const previousRole = context.player.role;
    if (role === 'spectator') {
      context.player.role = 'spectator';
      context.player.team = 'none';
    } else {
      if (context.player.team === 'none') {
        const activeGame =
          context.room.game && context.room.game.phase !== 'finished' ? context.room.game : null;
        context.player.team = activeGame ? activeGame.currentTeam : 'red';
      }

      context.player.role = role;
    }

    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);

    ackOk(callback, { team: context.player.team, role: context.player.role });
  });

  socket.on('game:start', (payload = {}, callback) => {
    const action = 'game:start';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
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

    startNewRound(context.room, 'host');
    ackOk(callback, { started: true });
  });

  socket.on('game:rematch', (payload = {}, callback) => {
    const action = 'game:rematch';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (context.room.hostSessionId !== context.player.sessionId) {
      sendViolation(socket, action, 'Only the host can start a rematch.');
      ackError(callback, 'Only the host can start a rematch.');
      return;
    }

    if (!context.room.game || context.room.game.phase !== 'finished') {
      ackError(callback, 'Rematch is only available after a game finishes.');
      return;
    }

    const mode = String(validatedPayload.mode || '').trim();
    if (mode === 'swap_teams') {
      swapRoomTeams(context.room);
    }

    const startedGame = startNewRound(context.room, mode === 'swap_teams' ? 'rematch_swap' : 'rematch');
    metrics.rematchStarted += 1;
    logEvent('rematch_started', {
      roomCode: context.room.code,
      mode,
      by: context.player.sessionId,
      roundNumber: startedGame.roundNumber,
      matchId: startedGame.matchId,
    });

    ackOk(callback, {
      started: true,
      mode,
      matchId: startedGame.matchId,
      roundNumber: startedGame.roundNumber,
    });
  });

  socket.on('turn:hint_submit', (payload = {}, callback) => {
    const action = 'turn:hint_submit';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
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

    const hintWord = normalizeHint(validatedPayload.word);
    const count = Number(validatedPayload.count);
    const modeConfig = getModeConfig(game.mode || getRoomMode(context.room), context.room);
    const maxHintCount = game.maxHintCount ?? modeConfig.maxHintCount;

    if (!hintWord) {
      ackError(callback, 'Hint word is required.');
      return;
    }

    const hintUpper = hintWord.toUpperCase();
    if (game.board.some(c => c.word === hintUpper)) {
      ackError(callback, 'Your hint cannot be a word on the board.');
      return;
    }

    if (!Number.isInteger(count) || count < 0 || (maxHintCount !== null && count > maxHintCount)) {
      ackError(callback, `Hint count must be an integer from 0${maxHintCount !== null ? ` to ${maxHintCount}` : ''}.`);
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

    syncPhaseTimerForCurrentPhase(context.room, game.phase, 'hint_submitted');
    emitStateToRoom(context.room);
    ackOk(callback, { accepted: true });
  });

  socket.on('turn:mark_toggle', (payload = {}, callback) => {
    const action = 'turn:mark_toggle';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
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
      ackError(callback, 'Marking is only available during guess phase.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
      sendViolation(socket, 'turn:mark_toggle', 'Only active-team operatives can mark words.');
      ackError(callback, 'Only active-team operatives can mark words.');
      return;
    }

    const index = Number(validatedPayload.index);
    if (!Number.isInteger(index) || index < 0 || index > 24) {
      ackError(callback, 'Card index must be between 0 and 24.');
      return;
    }

    const card = game.board[index];
    if (card.revealed) {
      ackError(callback, 'Cannot mark a revealed card.');
      return;
    }

    const marks = game.marksByCard[index];
    if (!marks) {
      ackError(callback, 'Card mark state unavailable.');
      return;
    }

    let marked;
    if (marks.has(context.player.sessionId)) {
      marks.delete(context.player.sessionId);
      marked = false;
    } else {
      marks.add(context.player.sessionId);
      marked = true;
    }

    game.lastActionAt = Date.now();
    game.history.push({
      type: 'mark_toggle',
      by: context.player.sessionId,
      team: context.player.team,
      index,
      marked,
      at: Date.now(),
    });
    context.room.lastActiveAt = Date.now();

    io.to(context.room.code).emit('turn:mark_toggled', {
      index,
      by: context.player.sessionId,
      marked,
    });

    emitStateToRoom(context.room);
    ackOk(callback, { index, marked });
  });

  socket.on('turn:guess', (payload = {}, callback) => {
    const action = 'turn:guess';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
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

    const index = Number(validatedPayload.index);
    if (!Number.isInteger(index) || index < 0 || index > 24) {
      ackError(callback, 'Card index must be between 0 and 24.');
      return;
    }

    const card = game.board[index];
    if (card.revealed) {
      ackError(callback, 'This card has already been revealed.');
      return;
    }

    const phaseBeforeGuess = game.phase;
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

    if (game.phase === 'finished') {
      clearPhaseTimerState(context.room);
      scheduleMvpTimeout(context.room);
    } else if (phaseBeforeGuess !== game.phase) {
      syncPhaseTimerForCurrentPhase(context.room, game.phase, 'phase_changed_after_guess');
    }

    emitStateToRoom(context.room);
    ackOk(callback, result);
  });

  socket.on('turn:end', (payload = {}, callback) => {
    const action = 'turn:end';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) {
      return;
    }

    const context = getContext(socket, action);
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

    syncPhaseTimerForCurrentPhase(context.room, game.phase, 'player_ended');
    emitStateToRoom(context.room);
    ackOk(callback, { ended: true });
  });

  // --- GG Button (Wave 6.1) ---
  socket.on('game:gg', (payload = {}, callback) => {
    const action = 'game:gg';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (!context.room.game || context.room.game.phase !== 'finished') {
      ackError(callback, 'GG is only available after game finishes.');
      return;
    }

    io.to(context.room.code).emit('game:gg_received', {
      sessionId: context.player.sessionId,
      name: context.player.name,
    });

    ackOk(callback, { sent: true });
  });

  // --- Text Chat ---
  const CHAT_MAX_MESSAGES = 200;

  socket.on('chat:send', (payload = {}, callback) => {
    const action = 'chat:send';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const text = String(validatedPayload.text).trim();
    if (!text) {
      ackError(callback, 'Message cannot be empty.');
      return;
    }

    const message = {
      sessionId: context.player.sessionId,
      name: context.player.name,
      team: context.player.team,
      text,
      ts: Date.now(),
    };

    context.room.chatMessages.push(message);
    if (context.room.chatMessages.length > CHAT_MAX_MESSAGES) {
      context.room.chatMessages.splice(0, context.room.chatMessages.length - CHAT_MAX_MESSAGES);
    }

    io.to(context.room.code).emit('chat:message', message);
    ackOk(callback, { sent: true });
  });

  // --- MVP Vote (Wave 6.2) ---
  socket.on('game:mvp_vote', (payload = {}, callback) => {
    const action = 'game:mvp_vote';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (!context.room.game || context.room.game.phase !== 'finished') {
      ackError(callback, 'MVP vote is only available after game finishes.');
      return;
    }

    const targetSessionId = String(validatedPayload.targetSessionId || '').trim();
    if (targetSessionId === context.player.sessionId) {
      ackError(callback, 'Cannot vote for yourself.');
      return;
    }

    const targetPlayer = context.room.players.get(targetSessionId);
    if (!targetPlayer) {
      ackError(callback, 'Target player not found.');
      return;
    }

    context.room.game.mvpVotes = context.room.game.mvpVotes || {};
    context.room.game.mvpVotes[context.player.sessionId] = targetSessionId;

    // Check if all connected team players have voted or 15s timeout
    const connectedTeam = [...context.room.players.values()].filter(p => p.connected && p.team !== 'none' && p.role !== 'spectator');
    const allVoted = connectedTeam.every(p => context.room.game.mvpVotes[p.sessionId]);

    if (allVoted) {
      clearMvpTimer(context.room.code);
      broadcastMvpResult(context.room);
    }

    ackOk(callback, { voted: true });
  });

  // --- Confidence Markers (Wave 6.3) ---
  socket.on('turn:mark_confidence', (payload = {}, callback) => {
    const action = 'turn:mark_confidence';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const game = context.room.game;
    if (!game || game.phase !== 'guess') {
      ackError(callback, 'Confidence marking is only available during guess phase.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
      ackError(callback, 'Only active-team operatives can set confidence.');
      return;
    }

    const index = Number(validatedPayload.index);
    if (!Number.isInteger(index) || index < 0 || index > 24) {
      ackError(callback, 'Card index must be between 0 and 24.');
      return;
    }

    // Store confidence in a parallel structure
    game.confidenceByCard = game.confidenceByCard || Array.from({ length: 25 }, () => ({}));
    game.confidenceByCard[index][context.player.sessionId] = validatedPayload.confidence;

    emitStateToRoom(context.room);
    ackOk(callback, { index, confidence: validatedPayload.confidence });
  });

  // --- Word Pack (Wave 8.4) ---
  socket.on('room:word_pack_set', (payload = {}, callback) => {
    const action = 'room:word_pack_set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (context.room.hostSessionId !== context.player.sessionId) {
      ackError(callback, 'Only the host can set word packs.');
      return;
    }

    if (isGameActive(context.room)) {
      ackError(callback, 'Cannot change word pack during an active game.');
      return;
    }

    const url = String(validatedPayload.url || '').trim();
    if (!url.startsWith('https://')) {
      ackError(callback, 'Word pack URL must use HTTPS.');
      return;
    }

    // Fetch and validate word pack asynchronously
    const roomCode = context.room.code;
    fetchWordPack(url)
      .then((words) => {
        const room = rooms.get(roomCode);
        if (!room) return;
        room.customWords = words;
        room.lastActiveAt = Date.now();
        emitStateToRoom(room);
        ackOk(callback, { loaded: true, wordCount: words.length });
      })
      .catch((error) => {
        ackError(callback, `Failed to load word pack: ${error.message}`);
      });
  });

  // ── Voice Chat Signaling ──

  socket.on('voice:join', (payload = {}, callback) => {
    const action = 'voice:join';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) { ackError(callback, 'You are not in a room.'); return; }

    const { room, player } = context;
    if (!room.voicePeers) room.voicePeers = new Set();

    // Send list of existing voice peers before adding this player
    const existingPeers = [...room.voicePeers].filter(id => id !== player.sessionId);
    room.voicePeers.add(player.sessionId);

    // Notify existing voice peers about the new joiner
    for (const peerId of existingPeers) {
      const peer = room.players.get(peerId);
      if (!peer || !peer.connected || !peer.socketId) continue;
      const peerSocket = io.sockets.sockets.get(peer.socketId);
      if (peerSocket) peerSocket.emit('voice:peer_joined', { sessionId: player.sessionId });
    }

    ackOk(callback, { peers: existingPeers });
  });

  socket.on('voice:leave', (payload = {}, callback) => {
    const action = 'voice:leave';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) { ackError(callback, 'You are not in a room.'); return; }

    handleVoiceLeave(context.room, context.player);
    ackOk(callback);
  });

  socket.on('voice:signal', (payload = {}, callback) => {
    const action = 'voice:signal';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) { ackError(callback, 'You are not in a room.'); return; }

    const { room, player } = context;
    const targetPlayer = room.players.get(validatedPayload.targetSessionId);
    if (!targetPlayer || !targetPlayer.connected || !targetPlayer.socketId) {
      ackError(callback, 'Target peer not found.');
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
    if (!targetSocket) { ackError(callback, 'Target peer not connected.'); return; }

    targetSocket.emit('voice:signal', {
      fromSessionId: player.sessionId,
      type: validatedPayload.type,
      sdp: validatedPayload.sdp,
      candidate: validatedPayload.candidate,
    });
    ackOk(callback);
  });

  socket.on('voice:mute', (payload = {}, callback) => {
    const action = 'voice:mute';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) { ackError(callback, 'You are not in a room.'); return; }

    const { room, player } = context;
    if (!room.voicePeers || !room.voicePeers.has(player.sessionId)) {
      ackError(callback, 'You are not in voice chat.');
      return;
    }

    for (const peerId of room.voicePeers) {
      if (peerId === player.sessionId) continue;
      const peer = room.players.get(peerId);
      if (!peer || !peer.connected || !peer.socketId) continue;
      const peerSocket = io.sockets.sockets.get(peer.socketId);
      if (peerSocket) peerSocket.emit('voice:mute_changed', { sessionId: player.sessionId, muted: validatedPayload.muted });
    }

    ackOk(callback);
  });

  socket.on('disconnect', () => {
    metrics.disconnect += 1;
    logEvent('socket_disconnected', { socketId: socket.id });
    markDisconnected(socket);
  });
});

setInterval(() => {
  const now = Date.now();

  for (const room of rooms.values()) {
    const removedCount = pruneDisconnectedPlayers(
      room,
      now,
      DISCONNECTED_PLAYER_TTL_MS,
      clearMarksForSession
    );
    ensureHostSession(room);

    if (room.players.size === 0 || now - room.lastActiveAt > STALE_ROOM_TTL_MS) {
      clearPhaseTimerState(room);
      logEvent('room_deleted', {
        roomCode: room.code,
        reason: room.players.size === 0 ? 'empty' : 'stale',
      });
      rooms.delete(room.code);
      continue;
    }

    if (removedCount > 0) {
      logEvent('room_pruned_by_ttl', { roomCode: room.code, removedCount });
      emitStateToRoom(room);
    }
  }
}, 60 * 1000).unref();

httpServer.listen(PORT, HOST, () => {
  logEvent('server_started', { host: HOST, port: PORT });
  console.log(`Taccan server listening on http://${HOST}:${PORT}`);
});

function gracefulShutdown(signal) {
  logEvent('shutdown_initiated', { signal });
  console.log(`\n${signal} received, shutting down gracefully...`);
  httpServer.close(() => {
    logEvent('server_closed', {});
    process.exit(0);
  });
  io.disconnectSockets(true);
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

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

function startNewRound(room, trigger = 'manual') {
  clearPhaseTimerState(room);
  clearMvpTimer(room.code);
  const match = getNextMatch(room);
  const roomMode = getRoomMode(room);
  const modeConfig = getModeConfig(roomMode, room);
  room.match = match;
  room.game = createGameState({
    matchId: match.id,
    roundNumber: match.roundNumber,
    mode: roomMode,
    maxHintCount: modeConfig.maxHintCount,
    customWords: room.customWords || null,
  });
  room.lastActiveAt = Date.now();

  io.to(room.code).emit('game:started', {
    roomCode: room.code,
    startingTeam: room.game.startingTeam,
    matchId: room.game.matchId,
    roundNumber: room.game.roundNumber,
    mode: room.game.mode,
    maxHintCount: room.game.maxHintCount,
    trigger,
  });

  syncPhaseTimerForCurrentPhase(room, room.game.phase, `round_started:${trigger}`);
  emitStateToRoom(room);
  metrics.gameStart += 1;
  logEvent('game_started', {
    roomCode: room.code,
    trigger,
    startingTeam: room.game.startingTeam,
    matchId: room.game.matchId,
    roundNumber: room.game.roundNumber,
    mode: room.game.mode,
    maxHintCount: room.game.maxHintCount,
  });

  return room.game;
}

function getNextMatch(room) {
  if (room.match && room.match.id && Number.isInteger(room.match.roundNumber)) {
    return {
      id: room.match.id,
      roundNumber: room.match.roundNumber + 1,
    };
  }

  return {
    id: randomUUID(),
    roundNumber: 1,
  };
}

function getNormalizedMode(value) {
  const normalized = String(value || '')
    .toLowerCase()
    .trim();
  return ROOM_MODE_VALUES.has(normalized) ? normalized : 'casual';
}

function getRoomMode(room) {
  if (!room) {
    return 'casual';
  }

  const normalized = getNormalizedMode(room.mode);
  if (room.mode !== normalized) {
    room.mode = normalized;
  }

  return normalized;
}

function getModeConfig(mode, room) {
  const normalizedMode = getNormalizedMode(mode);
  const config = { ...(MODE_CONFIG[normalizedMode] || MODE_CONFIG.casual) };
  if (normalizedMode === 'blitz' && room && room.blitzConfig) {
    if (Number.isInteger(room.blitzConfig.hintTimerMs) && room.blitzConfig.hintTimerMs > 0) {
      config.hintTimerMs = room.blitzConfig.hintTimerMs;
    }
    if (Number.isInteger(room.blitzConfig.guessTimerMs) && room.blitzConfig.guessTimerMs > 0) {
      config.guessTimerMs = room.blitzConfig.guessTimerMs;
    }
  }
  return config;
}

function clearPhaseTimer(roomCode) {
  const timer = phaseTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    phaseTimers.delete(roomCode);
  }
}

function clearPhaseTimerState(room) {
  if (!room) {
    return;
  }

  clearPhaseTimer(room.code);
  if (room.game && room.game.phaseTimer) {
    room.game.phaseTimer = null;
  }
}

function syncPhaseTimerForCurrentPhase(room, phase, reason = 'phase_changed') {
  if (!room || !room.game || room.game.phase === 'finished') {
    clearPhaseTimerState(room);
    return false;
  }

  const game = room.game;
  const currentPhase = game.phase;
  const expectedPhase = phase || currentPhase;
  if (expectedPhase !== currentPhase) {
    return false;
  }

  clearPhaseTimer(room.code);

  const modeConfig = getModeConfig(game.mode || getRoomMode(room), room);
  const durationMs = currentPhase === 'hint' ? modeConfig.hintTimerMs : modeConfig.guessTimerMs;
  if (!Number.isInteger(durationMs) || durationMs <= 0) {
    game.phaseTimer = null;
    return false;
  }

  const startedAt = Date.now();
  const endsAt = startedAt + durationMs;
  const timerId = randomUUID();
  game.phaseTimer = {
    id: timerId,
    phase: currentPhase,
    startedAt,
    endsAt,
    durationMs,
  };

  const timer = setTimeout(() => {
    finalizePhaseTimer(room.code, timerId);
  }, Math.max(durationMs, 1));
  if (typeof timer.unref === 'function') {
    timer.unref();
  }
  phaseTimers.set(room.code, timer);

  io.to(room.code).emit('turn:timer_started', {
    roomCode: room.code,
    phase: currentPhase,
    startedAt,
    endsAt,
    durationMs,
  });

  metrics.turnTimerStarted += 1;
  logEvent('turn_timer_started', {
    roomCode: room.code,
    phase: currentPhase,
    endsAt,
    reason,
  });

  return true;
}

function finalizePhaseTimer(roomCode, timerId) {
  const room = rooms.get(roomCode);
  clearPhaseTimer(roomCode);

  if (!room || !room.game || room.game.phase === 'finished') {
    return;
  }

  const game = room.game;
  const phaseTimer = game.phaseTimer;
  if (!phaseTimer || phaseTimer.id !== timerId) {
    return;
  }

  const expiredPhase = phaseTimer.phase;
  if (game.phase !== expiredPhase) {
    game.phaseTimer = null;
    return;
  }

  game.phaseTimer = null;
  const timeoutReason = expiredPhase === 'hint' ? 'hint_timeout' : 'guess_timeout';
  advanceTurn(game, timeoutReason);
  room.lastActiveAt = Date.now();

  io.to(room.code).emit('turn:timer_expired', {
    roomCode: room.code,
    phase: expiredPhase,
    outcome: timeoutReason,
    nextTeam: game.currentTeam,
  });
  io.to(room.code).emit('turn:ended', {
    reason: timeoutReason,
    nextTeam: game.currentTeam,
  });

  metrics.turnTimerExpired += 1;
  logEvent('turn_timer_expired', {
    roomCode: room.code,
    phase: expiredPhase,
    outcome: timeoutReason,
    nextTeam: game.currentTeam,
  });

  syncPhaseTimerForCurrentPhase(room, game.phase, timeoutReason);
  emitStateToRoom(room);
}

function swapRoomTeams(room) {
  for (const player of room.players.values()) {
    if (player.team === 'red') {
      player.team = 'blue';
      continue;
    }

    if (player.team === 'blue') {
      player.team = 'red';
    }
  }
}

function preflightAction(socket, action, payload, callback) {
  const validated = validatePayload(action, payload);
  if (!validated.ok) {
    ackError(callback, validated.error || 'Invalid payload.');
    return null;
  }

  if (!consumeRateLimit(socket, action)) {
    metrics.rateLimited += 1;
    sendViolation(socket, action, 'Too many requests. Slow down and try again.');
    ackError(callback, 'Too many requests. Slow down and try again.');
    return null;
  }

  return validated.value;
}

function consumeRateLimit(socket, action) {
  const now = Date.now();
  const limits = EVENT_RATE_LIMITS[action] || EVENT_RATE_LIMITS.default;
  const buckets = socket.data.rateBuckets || (socket.data.rateBuckets = {});
  const bucket = buckets[action] || { count: 0, startedAt: now };

  if (now - bucket.startedAt >= limits.windowMs) {
    bucket.count = 0;
    bucket.startedAt = now;
  }

  if (bucket.count >= limits.max) {
    buckets[action] = bucket;
    return false;
  }

  bucket.count += 1;
  buckets[action] = bucket;
  return true;
}

function validateRoomReadiness(room) {
  return getRoomReadinessError(room);
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
  const game = room.game ? buildGameView(room, room.game, viewer) : null;

  return {
    now: Date.now(),
    room: {
      code: room.code,
      status: deriveRoomStatus(room),
      hostSessionId: room.hostSessionId,
      createdAt: room.createdAt,
      mode: getRoomMode(room),
      modeConfig: getModeConfig(getRoomMode(room), room),
      match: room.match
        ? {
            id: room.match.id,
            roundNumber: room.match.roundNumber,
          }
        : null,
      chatMessages: room.chatMessages,
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

function buildGameView(room, game, viewer) {
  const showKeycard = viewer.role === 'spymaster' || game.phase === 'finished';

  // Include hint history for sidebar (Wave 3.2)
  const history = game.history
    .filter((e) => e.type === 'hint' || e.type === 'guess' || e.type === 'turn_end' || e.type === 'game_end');

  return {
    id: game.id,
    matchId: game.matchId || null,
    roundNumber: Number.isInteger(game.roundNumber) ? game.roundNumber : null,
    phase: game.phase,
    currentTeam: game.currentTeam,
    startingTeam: game.startingTeam,
    turnNumber: game.turnNumber,
    mode: game.mode || getRoomMode(room),
    seed: game.seed || null,
    maxHintCount: game.maxHintCount ?? getModeConfig(game.mode || getRoomMode(room), room).maxHintCount,
    phaseTimer: game.phaseTimer
      ? {
          phase: game.phaseTimer.phase,
          startedAt: game.phaseTimer.startedAt,
          endsAt: game.phaseTimer.endsAt,
          durationMs: game.phaseTimer.durationMs,
        }
      : null,
    hint: game.hint,
    guessesRemaining: game.guessesRemaining,
    remaining: game.remaining,
    winner: game.winner,
    loser: game.loser,
    reason: game.reason,
    showKeycard,
    history,
    board: game.board.map((card) => {
      const marksForCard = game.marksByCard?.[card.index] || new Set();
      const confidenceForCard = game.confidenceByCard?.[card.index] || {};
      return {
        index: card.index,
        word: card.word,
        revealed: card.revealed,
        revealedBy: card.revealed ? card.revealedBy : null,
        color: card.revealed || showKeycard ? card.color : null,
        marks: card.revealed
          ? []
          : [...marksForCard]
              .map((sessionId) => room.players.get(sessionId))
              .filter(Boolean)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((player) => ({
                sessionId: player.sessionId,
                name: player.name,
                team: player.team,
                confidence: confidenceForCard[player.sessionId] || 'firm',
              })),
      };
    }),
  };
}

function broadcastMvpResult(room) {
  if (!room.game || !room.game.mvpVotes) return;
  const votes = room.game.mvpVotes;
  const tally = {};
  for (const targetId of Object.values(votes)) {
    tally[targetId] = (tally[targetId] || 0) + 1;
  }
  let maxVotes = 0;
  let winnerId = null;
  for (const [id, count] of Object.entries(tally)) {
    if (count > maxVotes) {
      maxVotes = count;
      winnerId = id;
    }
  }
  const winner = winnerId ? room.players.get(winnerId) : null;
  io.to(room.code).emit('game:mvp_result', {
    winner: winner ? { sessionId: winner.sessionId, name: winner.name } : null,
    votes: tally,
  });
}

function scheduleMvpTimeout(room) {
  clearMvpTimer(room.code);
  mvpTimers.set(room.code, setTimeout(() => {
    mvpTimers.delete(room.code);
    broadcastMvpResult(room);
  }, 30_000));
}

function clearMvpTimer(roomCode) {
  const timer = mvpTimers.get(roomCode);
  if (timer) {
    clearTimeout(timer);
    mvpTimers.delete(roomCode);
  }
}

function isPrivateIP(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length === 4) {
    if (parts[0] === 10) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 0) return true;
  }
  if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
  return false;
}

async function fetchWordPack(url) {
  const https = require('https');
  const dns = require('dns');
  const safeLookup = (hostname, options, cb) => {
    dns.lookup(hostname, options, (err, address, family) => {
      if (err) return cb(err);
      if (isPrivateIP(address)) return cb(new Error('URL resolves to a private/internal address.'));
      cb(null, address, family);
    });
  };
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10_000, lookup: safeLookup }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        res.resume();
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const words = JSON.parse(data);
          if (!Array.isArray(words) || words.length < 50) {
            reject(new Error('Word pack must be a JSON array with at least 50 strings.'));
            return;
          }
          const validated = words.filter(w => typeof w === 'string' && w.trim().length > 0).map(w => w.trim());
          if (validated.length < 50) {
            reject(new Error('Word pack must contain at least 50 valid strings.'));
            return;
          }
          resolve(validated);
        } catch (e) {
          reject(new Error('Invalid JSON.'));
        }
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout.')); });
  });
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

function handleVoiceLeave(room, player) {
  if (!room.voicePeers || !room.voicePeers.has(player.sessionId)) return;
  room.voicePeers.delete(player.sessionId);
  for (const peerId of room.voicePeers) {
    const peer = room.players.get(peerId);
    if (!peer || !peer.connected || !peer.socketId) continue;
    const peerSocket = io.sockets.sockets.get(peer.socketId);
    if (peerSocket) peerSocket.emit('voice:peer_left', { sessionId: player.sessionId });
  }
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
    handleVoiceLeave(room, player);
    ensureHostSession(room);
    emitStateToRoom(room);
  }

  clearSocketBinding(socket);
}

function removePlayerFromRoom(room, sessionId) {
  const departingPlayer = room.players.get(sessionId);
  if (departingPlayer) handleVoiceLeave(room, departingPlayer);
  clearMarksForSession(room, sessionId);
  room.players.delete(sessionId);
  room.lastActiveAt = Date.now();
  ensureHostSession(room);

  if (room.players.size === 0) {
    clearPhaseTimerState(room);
    logEvent('room_deleted', { roomCode: room.code, reason: 'empty' });
    rooms.delete(room.code);
    return;
  }
  emitStateToRoom(room);
}

function clearMarksForSession(room, sessionId) {
  if (!room.game || !room.game.marksByCard) {
    return;
  }

  for (const marks of room.game.marksByCard) {
    marks.delete(sessionId);
  }
}

function sendViolation(socket, action, message) {
  metrics.ruleViolation += 1;
  logEvent('rule_violation', { action, socketId: socket.id, message });
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

function logEvent(event, fields = {}) {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...fields,
  };
  console.log(JSON.stringify(payload));
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
 * @property {string | null} matchId
 * @property {number | null} roundNumber
 * @property {'casual' | 'blitz'} mode
 * @property {number} maxHintCount
 * @property {{id: string, phase: 'hint' | 'guess', startedAt: number, endsAt: number, durationMs: number} | null} phaseTimer
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
 * @property {Set<string>[]} marksByCard
 * @property {Object[]} history
 *
 * @typedef {Object} Room
 * @property {string} code
 * @property {number} createdAt
 * @property {number} lastActiveAt
 * @property {string | null} hostSessionId
 * @property {Map<string, Player>} players
 * @property {'casual' | 'blitz'} mode
 * @property {{id: string, roundNumber: number} | null} match
 * @property {GameState | null} game
 */
