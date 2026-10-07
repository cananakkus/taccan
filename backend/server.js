const { createAccountSessions } = require('./account-session');
const { createVoiceInfrastructure } = require('./voice-infrastructure');
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
const { getIceServers } = require('./turn-config');

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

  const accounts = createAccountSessions({ secret: options.accountSecret ?? process.env.PLAY_ACCOUNT_SECRET });
  const voiceInfrastructure = createVoiceInfrastructure({ env: options.voiceEnv, authorize: options.authorizeVoice });
  io.use(accounts.middleware);

  // Accept both direct subpath requests and requests whose proxy stripped it.
  // This must run before Socket.IO inspects HTTP and WebSocket upgrade URLs.
  function normalizeApiPath(req) {
    const prefix = req.url.match(/^\/(?:murmur)(?=\/(?:api|socket\.io)(?:[/?]|$))/);
    if (prefix) {
      req.url = req.url.slice(prefix[0].length);
    }
  }
  httpServer.prependListener('request', normalizeApiPath);
  httpServer.prependListener('upgrade', normalizeApiPath);

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
  const savedState = options.restoreState === false ? null : loadState(options.stateFile);
  if (savedState) {
    const restored = restoreRooms(savedState);
    for (const [code, room] of restored) rooms.set(code, room);
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'state_restored', roomCount: restored.size }));
  }

  // ── Express Setup ──

  app.use(express.json({ limit: '64kb', type:req=>!req.url.startsWith('/_party/')&&Boolean(req.is('application/json')) }));
  const frontendSourceDir = path.join(__dirname, '..', 'frontend');
  const frontendDistDir = path.join(frontendSourceDir, 'dist');
  const frontendDir = fs.existsSync(path.join(frontendDistDir, 'index.html'))
    ? frontendDistDir
    : frontendSourceDir;
  const staticOpts = { setHeaders(res) { res.setHeader('Cache-Control', 'no-cache'); } };
  app.use(express.static(frontendDir, staticOpts));
  app.use(['/murmur'], express.static(frontendDir, staticOpts));

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
  const partySecret=options.partySecret ?? process.env.PARTY_SECRET;
  const party=partySecret?require('./party-support').createPartySupport(ctx,{secret:partySecret,file:options.partyFile||process.env.PARTY_DATA_FILE||'state/party.sqlite'}):null;
  app.use((req,res,next)=>{if(!req.path.startsWith('/_party/'))return next();if(!party)return res.status(404).json({error:'Not found'});party.handle(req,res).catch(next)});

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
    res.setHeader('Cache-Control', 'no-store');
    // Compatibility for old tabs. Relay credentials require a bound socket.
    res.json({ iceServers: getIceServers({}) });
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

  app.get(['/room/:code', '/murmur/room/:code'], (_req, res) => {
    res.sendFile(path.join(frontendDir, 'index.html'));
  });

  // ── Deps Object ──

  const deps = { io, rooms, phaseTimers, mvpTimers, metrics, constants, helpers, voiceInfrastructure };

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
    accounts.register(socket, helpers);
    helpers.logEvent('socket_connected', { socketId: socket.id });
    socket.emit('server:ready', { now: Date.now() });
    for (const register of handlerRegisters) register(socket, deps);
    party?.register(socket);
  });

  // ── Periodic Cleanup ──

  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if(room.party)continue;
      const removedCount = pruneDisconnectedPlayers(room, now, DISCONNECTED_PLAYER_TTL_MS, helpers.clearMarksForSession);
      ensureHostSession(room);
      if (room.players.size === 0 || now - room.lastActiveAt > STALE_ROOM_TTL_MS) {
        helpers.clearPhaseTimerState(room);
        helpers.clearMvpTimer(room.code);
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

  return { app, httpServer, io, rooms, phaseTimers, mvpTimers, metrics, cleanupInterval,
    party, saveState: (state = rooms) => saveState(new Map([...state].filter(([,r])=>!r.party)), options.stateFile) };
}

// ── Main ──

if (require.main === module) {
  const { httpServer, io, rooms, cleanupInterval, phaseTimers, mvpTimers, party, saveState: save } = createApp();
  httpServer.listen(PORT, HOST, () => {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'server_started', host: HOST, port: PORT }));
    console.log(`Murmur server listening on http://${HOST}:${PORT}`);
  });

  let shuttingDown = false;
  function gracefulShutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'shutdown_initiated', signal }));
    console.log(`\n${signal} received, shutting down gracefully...`);
    save(rooms);
    party?.close();
    clearInterval(cleanupInterval);
    for (const timer of [...phaseTimers.values(), ...mvpTimers.values()]) clearTimeout(timer);
    io.close(() => {
      console.log(JSON.stringify({ ts: new Date().toISOString(), event: 'server_closed' }));
      process.exit(0);
    });
    setTimeout(() => { console.error('Forced shutdown after timeout'); process.exit(1); }, SHUTDOWN_TIMEOUT_MS).unref();
  }
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { createApp };
