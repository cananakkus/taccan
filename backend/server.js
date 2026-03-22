const path = require('path');
const express = require('express');
const http = require('http');
const { randomUUID } = require('crypto');
const { Server } = require('socket.io');
const { validatePayload } = require('./payload-schema');
const { createGameState, advanceTurn } = require('./game-engine');
const {
  getSortedPlayers,
  getConnectedPlayerCount,
  getConnectedPlayersCountGlobal,
  ensureHostSession,
  pruneDisconnectedPlayers,
  getRoomReadinessError,
} = require('./room-utils');

const registerRoomHandlers = require('./handlers/room');
const registerRoomConfigHandlers = require('./handlers/room-config');
const registerTeamRoleHandlers = require('./handlers/team-role');
const registerGameHandlers = require('./handlers/game');
const registerTurnHandlers = require('./handlers/turn');
const registerChatHandlers = require('./handlers/chat');
const registerMvpHandlers = require('./handlers/mvp');
const registerVoiceHandlers = require('./handlers/voice');
const registerDisconnectHandler = require('./handlers/disconnect');

// ── Constants ──

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
  casual: { hintTimerMs: null, guessTimerMs: null, maxHintCount: null },
  blitz: { hintTimerMs: BLITZ_HINT_TIMER_MS_DEFAULT, guessTimerMs: BLITZ_GUESS_TIMER_MS_DEFAULT, maxHintCount: 9 },
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

// ── App Factory ──

function createApp(options = {}) {
  const app = express();
  const httpServer = http.createServer(app);
  const corsOrigin = options.corsOrigin || process.env.CORS_ORIGIN || 'https://play.wleeaf.dev';
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin === '*' ? true : corsOrigin.split(','), methods: ['GET', 'POST'] },
  });

  const metrics = {
    roomCreate: 0, roomJoin: 0, roomRejoin: 0, roomLeave: 0, roomPrune: 0,
    modeSet: 0, rematchStarted: 0, gameStart: 0,
    turnTimerStarted: 0, turnTimerExpired: 0,
    ruleViolation: 0, rateLimited: 0, disconnect: 0,
  };

  /** @type {Map<string, Room>} */
  const rooms = new Map();
  /** @type {Map<string, NodeJS.Timeout>} */
  const phaseTimers = new Map();
  /** @type {Map<string, NodeJS.Timeout>} */
  const mvpTimers = new Map();

  // ── State Restore ──
  const { saveState, loadState, restoreRooms } = require('./state-persistence');
  const savedState = loadState();
  if (savedState) {
    const restored = restoreRooms(savedState);
    for (const [code, room] of restored) rooms.set(code, room);
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'state_restored', roomCount: restored.size }));
  }

  // ── Express Setup ──

  app.use(express.json({ limit: '64kb' }));
  app.use(express.static(path.join(__dirname, '..', 'frontend'), {
    setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); },
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
    res.json({
      ok: true,
      room: {
        code: room.code,
        status: deriveRoomStatus(room),
        playerCount: room.players.size,
        connectedPlayers: getConnectedPlayerCount(room),
        mode: getRoomMode(room),
        hasActiveGame: Boolean(room.game && room.game.phase !== 'finished'),
        match: room.match ? { id: room.match.id, roundNumber: room.match.roundNumber } : null,
      },
    });
  });

  app.get('/room/:code', (_req, res) => {
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
  });

  // ── Helper Functions ──

  function sanitizeName(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ').slice(0, PLAYER_NAME_MAX);
    return normalized || `Player-${Math.floor(Math.random() * 900 + 100)}`;
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
    for (let attempt = 0; attempt < 100; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    throw new Error('Failed to generate unique room code after 100 attempts.');
  }

  function getNormalizedMode(value) {
    const normalized = String(value || '').toLowerCase().trim();
    return ROOM_MODE_VALUES.has(normalized) ? normalized : 'casual';
  }

  function getRoomMode(room) {
    if (!room) return 'casual';
    const normalized = getNormalizedMode(room.mode);
    if (room.mode !== normalized) room.mode = normalized;
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

  function isGameActive(room) {
    return Boolean(room.game && room.game.phase !== 'finished');
  }

  function validateRoomReadiness(room) {
    return getRoomReadinessError(room);
  }

  function deriveRoomStatus(room) {
    if (!room.game) return 'lobby';
    if (room.game.phase === 'finished') return 'finished';
    return 'in_game';
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
      roomCode: room.code, trigger,
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
      return { id: room.match.id, roundNumber: room.match.roundNumber + 1 };
    }
    return { id: randomUUID(), roundNumber: 1 };
  }

  function swapRoomTeams(room) {
    for (const player of room.players.values()) {
      if (player.team === 'red') { player.team = 'blue'; continue; }
      if (player.team === 'blue') { player.team = 'red'; }
    }
  }

  // ── Phase Timer Helpers ──

  function clearPhaseTimer(roomCode) {
    const timer = phaseTimers.get(roomCode);
    if (timer) { clearTimeout(timer); phaseTimers.delete(roomCode); }
  }

  function clearPhaseTimerState(room) {
    if (!room) return;
    clearPhaseTimer(room.code);
    if (room.game && room.game.phaseTimer) room.game.phaseTimer = null;
  }

  function syncPhaseTimerForCurrentPhase(room, phase, reason = 'phase_changed') {
    if (!room || !room.game || room.game.phase === 'finished') {
      clearPhaseTimerState(room);
      return false;
    }
    const game = room.game;
    const currentPhase = game.phase;
    if ((phase || currentPhase) !== currentPhase) return false;

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
    game.phaseTimer = { id: timerId, phase: currentPhase, startedAt, endsAt, durationMs };

    const timer = setTimeout(() => finalizePhaseTimer(room.code, timerId), Math.max(durationMs, 1));
    if (typeof timer.unref === 'function') timer.unref();
    phaseTimers.set(room.code, timer);

    io.to(room.code).emit('turn:timer_started', {
      roomCode: room.code, phase: currentPhase, startedAt, endsAt, durationMs,
    });
    metrics.turnTimerStarted += 1;
    logEvent('turn_timer_started', { roomCode: room.code, phase: currentPhase, endsAt, reason });
    return true;
  }

  function finalizePhaseTimer(roomCode, timerId) {
    const room = rooms.get(roomCode);
    clearPhaseTimer(roomCode);
    if (!room || !room.game || room.game.phase === 'finished') return;

    const game = room.game;
    const phaseTimer = game.phaseTimer;
    if (!phaseTimer || phaseTimer.id !== timerId) return;

    const expiredPhase = phaseTimer.phase;
    if (game.phase !== expiredPhase) { game.phaseTimer = null; return; }

    game.phaseTimer = null;
    const timeoutReason = expiredPhase === 'hint' ? 'hint_timeout' : 'guess_timeout';
    advanceTurn(game, timeoutReason);
    room.lastActiveAt = Date.now();

    io.to(room.code).emit('turn:timer_expired', {
      roomCode: room.code, phase: expiredPhase, outcome: timeoutReason, nextTeam: game.currentTeam,
    });
    io.to(room.code).emit('turn:ended', { reason: timeoutReason, nextTeam: game.currentTeam });

    metrics.turnTimerExpired += 1;
    logEvent('turn_timer_expired', {
      roomCode: room.code, phase: expiredPhase, outcome: timeoutReason, nextTeam: game.currentTeam,
    });

    syncPhaseTimerForCurrentPhase(room, game.phase, timeoutReason);
    emitStateToRoom(room);
  }

  // ── MVP Helpers ──

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
      if (count > maxVotes) { maxVotes = count; winnerId = id; }
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
    if (timer) { clearTimeout(timer); mvpTimers.delete(roomCode); }
  }

  // ── Socket / State Helpers ──

  function preflightAction(socket, action, payload, callback) {
    const validated = validatePayload(action, payload);
    if (!validated.ok) { ackError(callback, validated.error || 'Invalid payload.'); return null; }
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
    if (now - bucket.startedAt >= limits.windowMs) { bucket.count = 0; bucket.startedAt = now; }
    if (bucket.count >= limits.max) { buckets[action] = bucket; return false; }
    bucket.count += 1;
    buckets[action] = bucket;
    return true;
  }

  function getContext(socket, action) {
    const roomCode = socket.data.roomCode;
    const sessionId = socket.data.sessionId;
    if (!roomCode || !sessionId) { sendViolation(socket, action, 'You are not currently in a room.'); return null; }
    const room = rooms.get(roomCode);
    if (!room) { sendViolation(socket, action, 'Room no longer exists.'); clearSocketBinding(socket); return null; }
    const player = room.players.get(sessionId);
    if (!player) { sendViolation(socket, action, 'Player session is not part of this room.'); clearSocketBinding(socket); return null; }
    return { room, player };
  }

  function bindSocketToPlayer(socket, room, player) {
    if (player.socketId && player.socketId !== socket.id) {
      const existingSocket = io.sockets.sockets.get(player.socketId);
      if (existingSocket) clearSocketBinding(existingSocket);
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
    if (socket.data.roomCode) socket.leave(socket.data.roomCode);
    socket.data.roomCode = null;
    socket.data.sessionId = null;
  }

  function leaveBoundRoom(socket) {
    const roomCode = socket.data.roomCode;
    const sessionId = socket.data.sessionId;
    if (!roomCode || !sessionId) return;
    const room = rooms.get(roomCode);
    if (room) {
      const player = room.players.get(sessionId);
      if (player && player.socketId === socket.id) removePlayerFromRoom(room, sessionId);
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
    if (!roomCode || !sessionId) return;
    const room = rooms.get(roomCode);
    if (!room) { clearSocketBinding(socket); return; }
    const player = room.players.get(sessionId);
    if (!player) { clearSocketBinding(socket); return; }
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
    if (!room.game || !room.game.marksByCard) return;
    for (const marks of room.game.marksByCard) marks.delete(sessionId);
  }

  function buildMarksForCard(room, game, cardIndex) {
    const marksForCard = game.marksByCard?.[cardIndex] || new Set();
    const confidenceForCard = game.confidenceByCard?.[cardIndex] || {};
    return [...marksForCard]
      .map((sessionId) => room.players.get(sessionId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((player) => ({
        sessionId: player.sessionId,
        name: player.name,
        team: player.team,
        confidence: confidenceForCard[player.sessionId] || 'firm',
      }));
  }

  function emitStateToRoom(room) {
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) continue;
      const socket = io.sockets.sockets.get(player.socketId);
      if (!socket) continue;
      socket.emit('state:full', buildStateForPlayer(room, player));
    }
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
        match: room.match ? { id: room.match.id, roundNumber: room.match.roundNumber } : null,
        chatMessages: room.chatMessages,
      },
      me: {
        sessionId: viewer.sessionId, name: viewer.name,
        team: viewer.team, role: viewer.role,
        connected: viewer.connected,
        isHost: room.hostSessionId === viewer.sessionId,
      },
      players: getSortedPlayers(room).map((player) => ({
        sessionId: player.sessionId, name: player.name,
        team: player.team, role: player.role,
        connected: player.connected, joinedAt: player.joinedAt,
        isHost: room.hostSessionId === player.sessionId,
      })),
      game,
    };
  }

  function buildGameView(room, game, viewer) {
    const showKeycard = viewer.role === 'spymaster' || game.phase === 'finished';
    const history = game.history.filter(
      (e) => e.type === 'hint' || e.type === 'guess' || e.type === 'turn_end' || e.type === 'game_end'
    );
    return {
      id: game.id,
      matchId: game.matchId || null,
      roundNumber: Number.isInteger(game.roundNumber) ? game.roundNumber : null,
      phase: game.phase, currentTeam: game.currentTeam,
      startingTeam: game.startingTeam, turnNumber: game.turnNumber,
      mode: game.mode || getRoomMode(room),
      seed: game.seed || null,
      maxHintCount: game.maxHintCount ?? getModeConfig(game.mode || getRoomMode(room), room).maxHintCount,
      phaseTimer: game.phaseTimer
        ? { phase: game.phaseTimer.phase, startedAt: game.phaseTimer.startedAt, endsAt: game.phaseTimer.endsAt, durationMs: game.phaseTimer.durationMs }
        : null,
      hint: game.hint, guessesRemaining: game.guessesRemaining,
      remaining: game.remaining,
      winner: game.winner, loser: game.loser, reason: game.reason,
      showKeycard, history,
      board: game.board.map((card) => {
        const marksForCard = game.marksByCard?.[card.index] || new Set();
        const confidenceForCard = game.confidenceByCard?.[card.index] || {};
        return {
          index: card.index, word: card.word,
          revealed: card.revealed,
          revealedBy: card.revealed ? card.revealedBy : null,
          color: card.revealed || showKeycard ? card.color : null,
          marks: card.revealed ? [] : [...marksForCard]
            .map((sessionId) => room.players.get(sessionId))
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((player) => ({
              sessionId: player.sessionId, name: player.name,
              team: player.team,
              confidence: confidenceForCard[player.sessionId] || 'firm',
            })),
        };
      }),
    };
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
    const safeLookup = (hostname, opts, cb) => {
      dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return cb(err);
        if (isPrivateIP(address)) return cb(new Error('URL resolves to a private/internal address.'));
        cb(null, address, family);
      });
    };
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 10_000, lookup: safeLookup }, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const words = JSON.parse(data);
            if (!Array.isArray(words) || words.length < 50) {
              reject(new Error('Word pack must be a JSON array with at least 50 strings.'));
              return;
            }
            const validated = words.filter((w) => typeof w === 'string' && w.trim().length > 0).map((w) => w.trim());
            if (validated.length < 50) { reject(new Error('Word pack must contain at least 50 valid strings.')); return; }
            resolve(validated);
          } catch (_e) { reject(new Error('Invalid JSON.')); }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout.')); });
    });
  }

  function sendViolation(socket, action, message) {
    metrics.ruleViolation += 1;
    logEvent('rule_violation', { action, socketId: socket.id, message });
    socket.emit('error:rule_violation', { action, message });
  }

  function ackOk(callback, payload = {}) {
    if (typeof callback === 'function') callback({ ok: true, ...payload });
  }

  function ackError(callback, error) {
    if (typeof callback === 'function') callback({ ok: false, error });
  }

  function logEvent(event, fields = {}) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
  }

  // ── Deps Object ──

  const constants = {
    ROOM_CODE_ALPHABET, TEAM_VALUES, ROLE_VALUES,
    PLAYER_NAME_MAX, ROOM_CONNECTED_LIMIT,
    DISCONNECTED_PLAYER_TTL_MS, STALE_ROOM_TTL_MS,
    ROOM_MODE_VALUES, MODE_CONFIG,
  };

  const helpers = {
    preflightAction, getContext, ackOk, ackError,
    sendViolation, logEvent,
    bindSocketToPlayer, clearSocketBinding,
    leaveBoundRoom, markDisconnected,
    createPlayer, createRoomCode, removePlayerFromRoom,
    sanitizeName, swapRoomTeams,
    emitStateToRoom, buildStateForPlayer, buildGameView,
    deriveRoomStatus,
    getRoomMode, getModeConfig, getNormalizedMode,
    isGameActive, validateRoomReadiness,
    syncPhaseTimerForCurrentPhase, clearPhaseTimerState,
    clearPhaseTimer, finalizePhaseTimer,
    scheduleMvpTimeout, broadcastMvpResult, clearMvpTimer,
    handleVoiceLeave, fetchWordPack, isPrivateIP,
    clearMarksForSession, buildMarksForCard, startNewRound, getNextMatch,
  };

  const deps = { io, rooms, phaseTimers, mvpTimers, metrics, constants, helpers };

  const handlerRegisters = [
    registerRoomHandlers,
    registerRoomConfigHandlers,
    registerTeamRoleHandlers,
    registerGameHandlers,
    registerTurnHandlers,
    registerChatHandlers,
    registerMvpHandlers,
    registerVoiceHandlers,
    registerDisconnectHandler,
  ];

  // ── Socket.IO Connection ──

  io.on('connection', (socket) => {
    socket.data.rateBuckets = {};
    logEvent('socket_connected', { socketId: socket.id });
    socket.emit('server:ready', { now: Date.now() });
    for (const register of handlerRegisters) register(socket, deps);
  });

  // ── Periodic Cleanup ──

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const removedCount = pruneDisconnectedPlayers(room, now, DISCONNECTED_PLAYER_TTL_MS, clearMarksForSession);
      ensureHostSession(room);
      if (room.players.size === 0 || now - room.lastActiveAt > STALE_ROOM_TTL_MS) {
        clearPhaseTimerState(room);
        logEvent('room_deleted', { roomCode: room.code, reason: room.players.size === 0 ? 'empty' : 'stale' });
        rooms.delete(room.code);
        continue;
      }
      if (removedCount > 0) {
        logEvent('room_pruned_by_ttl', { roomCode: room.code, removedCount });
        emitStateToRoom(room);
      }
    }
  }, 60 * 1000);
  cleanupInterval.unref();

  return { app, httpServer, io, rooms, phaseTimers, mvpTimers, metrics, cleanupInterval, saveState };
}

// ── Main ──

if (require.main === module) {
  const { httpServer, rooms, saveState: save } = createApp();
  httpServer.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'server_started', host: HOST, port: PORT }));
    console.log(`Taccan server listening on http://${HOST}:${PORT}`);
  });

  function gracefulShutdown(signal) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'shutdown_initiated', signal }));
    console.log(`\n${signal} received, shutting down gracefully...`);
    save(rooms);
    httpServer.close(() => {
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'server_closed' }));
      process.exit(0);
    });
    setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, 10_000).unref();
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { createApp };
