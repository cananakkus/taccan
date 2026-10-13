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
const registerBotHandlers = require('./handlers/bots');
const { createBotDriver } = require('./bots');

// ── Constants ──

const {
  ROOM_CODE_ALPHABET, TEAM_VALUES, ROLE_VALUES,
  PLAYER_NAME_MAX, ROOM_CONNECTED_LIMIT,
  DISCONNECTED_PLAYER_TTL_MS, STALE_ROOM_TTL_MS,
  MAX_ROOM_CODE_ATTEMPTS, MVP_TIMEOUT_MS,
  CLEANUP_INTERVAL_MS, SHUTDOWN_TIMEOUT_MS,
  ROOM_MODE_VALUES,
} = require('./constants');

const SOCKET_FLOOD_MAX = 400;
const SOCKET_FLOOD_WINDOW_MS = 10_000;
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
    handlerErrors: 0, floodDisconnects: 0, roomErrors: 0,
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
    ...require('./turn-actions')(ctx),
    withRoomLock,
  };
  ctx.helpers = helpers;
  // One driver plays every bot seat, in party matches and in normal rooms.
  const bots = createBotDriver(ctx, { delayScale: options.botDelayScale ?? (Number(process.env.BOT_DELAY_SCALE) || 1) });
  ctx.bots = bots;
  const emitState = helpers.emitStateToRoom;
  helpers.emitStateToRoom = (room) => {
    emitState(room);
    helpers.guardRoom(room, 'bot_kick', () => bots.kick(room));
  };
  for (const room of rooms.values()) helpers.guardRoom(room, 'bot_restore', () => bots.kick(room));
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
    registerBotHandlers,
    registerDisconnectHandler,
  ];

  // ── Socket.IO Connection ──

  // One bad message must never take the process (and every room) down: each
  // handler runs inside its own try/catch, and async handlers' rejections are
  // caught too. The client gets a generic error ack instead.
  function guardHandler(socket, event, handler) {
    return function guarded(...args) {
      const callback = typeof args[args.length - 1] === 'function' ? args[args.length - 1] : null;
      const fail = (error) => {
        metrics.handlerErrors += 1;
        helpers.logEvent('handler_failed', { action: event, socketId: socket.id, roomCode: socket.data.roomCode || null, message: String(error?.stack || error).slice(0, 600) });
        try { callback?.({ ok: false, error: 'Could not complete action. Try again.' }); } catch {}
      };
      try {
        const result = handler.apply(this, args);
        if (result && typeof result.then === 'function') result.then(undefined, fail);
        return result;
      } catch (error) { fail(error); }
    };
  }

  const floodMax = options.socketFloodMax ?? SOCKET_FLOOD_MAX;
  io.on('connection', (socket) => {
    socket.data.rateBuckets = {};
    // A socket that floods (any mix of events, valid or not) is closed; its
    // seat stays and can be resumed with room:rejoin.
    let floodStart = Date.now(), floodCount = 0;
    socket.use((_packet, next) => {
      const now = Date.now();
      if (now - floodStart >= SOCKET_FLOOD_WINDOW_MS) { floodStart = now; floodCount = 0; }
      floodCount += 1;
      if (floodCount > floodMax) {
        if (floodCount === floodMax + 1) {
          metrics.floodDisconnects += 1;
          helpers.logEvent('socket_flood', { socketId: socket.id, roomCode: socket.data.roomCode || null });
          setImmediate(() => socket.disconnect(true));
        }
        return;
      }
      next();
    });
    const on = socket.on;
    socket.on = function guardedOn(event, handler) { return on.call(this, event, guardHandler(socket, event, handler)); };
    try {
      accounts.register(socket, helpers);
      helpers.logEvent('socket_connected', { socketId: socket.id });
      socket.emit('server:ready', { now: Date.now() });
      for (const register of handlerRegisters) register(socket, deps);
      party?.register(socket);
    } catch (error) {
      helpers.logEvent('connection_setup_failed', { socketId: socket.id, message: error.message });
      socket.disconnect(true);
    } finally {
      socket.on = on;
    }
    // Unknown events get a clear error instead of a silent client timeout.
    socket.onAny((event, ...args) => {
      if (socket.listenerCount(event) > 0) return;
      const callback = args[args.length - 1];
      if (typeof callback === 'function') { try { callback({ ok: false, error: 'Unknown action.' }); } catch {} }
    });
  });

  // ── Periodic Cleanup ──

  const hasHumans = (room) => [...room.players.values()].some((player) => !player.bot);
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const room of rooms.values()) {
      if(room.party)continue;
      try {
      const removedCount = pruneDisconnectedPlayers(room, now, DISCONNECTED_PLAYER_TTL_MS, helpers.clearMarksForSession);
      ensureHostSession(room);
      if (!hasHumans(room) || now - room.lastActiveAt > STALE_ROOM_TTL_MS) {
        helpers.clearPhaseTimerState(room);
        helpers.clearMvpTimer(room.code);
        helpers.logEvent('room_deleted', { roomCode: room.code, reason: !hasHumans(room) ? 'empty' : 'stale' });
        bots.cancel(room.code);
        rooms.delete(room.code);
        continue;
      }
      if (removedCount > 0) {
        helpers.logEvent('room_pruned_by_ttl', { roomCode: room.code, removedCount });
        helpers.emitStateToRoom(room);
      }
      } catch (error) { helpers.reportRoomError(room, 'cleanup', error); }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanupInterval.unref();

  return { app, httpServer, io, rooms, phaseTimers, mvpTimers, metrics, cleanupInterval, bots,
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
  // Last line of defence: a stray rejection is logged, never fatal.
  process.on('unhandledRejection', (error) => {
    console.error(JSON.stringify({ ts: new Date().toISOString(), event: 'unhandled_rejection', message: String(error?.stack || error).slice(0, 600) }));
  });
  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { createApp };
