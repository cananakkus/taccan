const path = require('path');
const fs = require('fs');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const {
  getConnectedPlayerCount,
  getConnectedPlayersCountGlobal,
  ensureHostSession,
  pruneDisconnectedPlayers,
} = require('./room-utils');

const createServerHelpers = require('./server-helpers');
const createStateView = require('./state-view');
const createTimers = require('./timers');
const createRoomLifecycle = require('./room-lifecycle');
const { withRoomLock } = require('./room-lock');

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

const {
  ROOM_CODE_ALPHABET, TEAM_VALUES, ROLE_VALUES,
  PLAYER_NAME_MAX, ROOM_CONNECTED_LIMIT,
  DISCONNECTED_PLAYER_TTL_MS, STALE_ROOM_TTL_MS,
  MAX_ROOM_CODE_ATTEMPTS, MVP_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS, SHUTDOWN_TIMEOUT_MS,
  ROOM_MODE_VALUES,
} = require('./constants');

const PORT = Number(process.env.PORT) || 3000;
const HOST = String(process.env.HOST || '127.0.0.1');
const BLITZ_HINT_TIMER_MS_DEFAULT = Number(process.env.BLITZ_HINT_TIMER_MS) || 25_000;
const BLITZ_GUESS_TIMER_MS_DEFAULT = Number(process.env.BLITZ_GUESS_TIMER_MS) || 35_000;
const MODE_CONFIG = {
  casual: { hintTimerMs: null, guessTimerMs: null, maxHintCount: null },
  blitz: { hintTimerMs: BLITZ_HINT_TIMER_MS_DEFAULT, guessTimerMs: BLITZ_GUESS_TIMER_MS_DEFAULT, maxHintCount: 9 },
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
  const frontendSourceDir = path.join(__dirname, '..', 'frontend');
  const frontendDistDir = path.join(frontendSourceDir, 'dist');
  const frontendDir = fs.existsSync(path.join(frontendDistDir, 'index.html'))
    ? frontendDistDir
    : frontendSourceDir;
  const staticOpts = { setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); } };
  app.use(express.static(frontendDir, staticOpts));
  app.use('/taccan', express.static(frontendDir, staticOpts));
  app.get('/taccan/socket.io/socket.io.js', (_req, res) => res.redirect('/socket.io/socket.io.js'));

  // ── Assemble Helpers ──

  const constants = {
    ROOM_CODE_ALPHABET, TEAM_VALUES, ROLE_VALUES,
    PLAYER_NAME_MAX, ROOM_CONNECTED_LIMIT,
    DISCONNECTED_PLAYER_TTL_MS, STALE_ROOM_TTL_MS,
    MAX_ROOM_CODE_ATTEMPTS, MVP_TIMEOUT_MS,
    CLEANUP_INTERVAL_MS, SHUTDOWN_TIMEOUT_MS,
    ROOM_MODE_VALUES, MODE_CONFIG,
  };

  const ctx = { io, rooms, phaseTimers, mvpTimers, metrics, constants, helpers: null };
  const helpers = {
    ...createServerHelpers(ctx),
    ...createStateView(ctx),
    ...createTimers(ctx),
    ...createRoomLifecycle(ctx),
    withRoomLock,
  };
  ctx.helpers = helpers;

  // ── API Routes ──

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      now: new Date().toISOString(),
      roomCount: rooms.size,
      connectedPlayers: getConnectedPlayersCountGlobal(rooms),
      metrics,
    });
  });

  app.get('/api/turn-credentials', (_req, res) => {
    const iceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
    const turnHost = process.env.TURN_HOST;
    const turnUsername = process.env.TURN_USERNAME;
    const turnCredential = process.env.TURN_CREDENTIAL;
    if (turnHost && turnUsername && turnCredential) {
      iceServers.push(
        { urls: `stun:${turnHost}:3478` },
        {
          urls: [`turn:${turnHost}:3478`, `turn:${turnHost}:3478?transport=tcp`],
          username: turnUsername,
          credential: turnCredential,
        },
      );
    }
    res.json({ iceServers });
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
        status: helpers.deriveRoomStatus(room),
        playerCount: room.players.size,
        connectedPlayers: getConnectedPlayerCount(room),
        mode: helpers.getRoomMode(room),
        hasActiveGame: Boolean(room.game && room.game.phase !== 'finished'),
        match: room.match ? { id: room.match.id, roundNumber: room.match.roundNumber } : null,
      },
    });
  });

  app.get(['/room/:code', '/taccan/room/:code'], (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });

  // ── Deps Object ──

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
    helpers.logEvent('socket_connected', { socketId: socket.id });
    socket.emit('server:ready', { now: Date.now() });
    for (const register of handlerRegisters) register(socket, deps);
  });

  // ── Periodic Cleanup ──

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      const removedCount = pruneDisconnectedPlayers(room, now, DISCONNECTED_PLAYER_TTL_MS, helpers.clearMarksForSession);
      ensureHostSession(room);
      if (room.players.size === 0 || now - room.lastActiveAt > STALE_ROOM_TTL_MS) {
        helpers.clearPhaseTimerState(room);
        helpers.logEvent('room_deleted', { roomCode: room.code, reason: room.players.size === 0 ? 'empty' : 'stale' });
        rooms.delete(room.code);
        continue;
      }
      if (removedCount > 0) {
        helpers.logEvent('room_pruned_by_ttl', { roomCode: room.code, removedCount });
        helpers.emitStateToRoom(room);
      }
    }
  }, CLEANUP_INTERVAL_MS);
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
    setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, SHUTDOWN_TIMEOUT_MS).unref();
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { createApp };
