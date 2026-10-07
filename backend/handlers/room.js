const { timingSafeEqual } = require('node:crypto');

module.exports = function register(socket, deps) {
  const { io, rooms, metrics, helpers, constants } = deps;
  const {
    preflightAction, getContext, ackOk, ackError, sendViolation, logEvent,
    leaveBoundRoom, createPlayer, createRoomCode,
    bindSocketToPlayer, clearSocketBinding,
    emitStateToRoom, removePlayerFromRoom,
    clearPhaseTimerState, clearMarksForSession,
    handleVoiceLeave, sanitizeName, syncPhaseTimerForCurrentPhase,
  } = helpers;
  const { ROOM_CONNECTED_LIMIT, DISCONNECTED_PLAYER_TTL_MS } = constants;
  const { getConnectedPlayerCount, ensureHostSession, pruneDisconnectedPlayers } = require('../room-utils');

  socket.on('room:create', (payload = {}, callback) => {
    const action = 'room:create';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    leaveBoundRoom(socket);

    const player = createPlayer(socket.data.account?.name ?? validatedPayload.name, socket.id);
    player.accountId = socket.data.account?.id ?? null;
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

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId, reconnectToken: player.reconnectToken });
  });

  socket.on('room:join', (payload = {}, callback) => {
    const action = 'room:join';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

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

    if(room.party){ackError(callback,'This is a private tournament match.');return;}

    if (socket.data.roomCode === code) {
      const current = getContext(socket, action);
      if (current) {
        emitStateToRoom(room);
        ackOk(callback, { roomCode: code, sessionId: current.player.sessionId, reconnectToken: current.player.reconnectToken });
        return;
      }
    }

    if (getConnectedPlayerCount(room) >= ROOM_CONNECTED_LIMIT) {
      ackError(callback, 'Room is full.');
      return;
    }

    leaveBoundRoom(socket);

    const player = createPlayer(socket.data.account?.name ?? validatedPayload.name, socket.id);
    player.accountId = socket.data.account?.id ?? null;
    room.players.set(player.sessionId, player);
    room.lastActiveAt = Date.now();
    ensureHostSession(room);

    bindSocketToPlayer(socket, room, player);
    emitStateToRoom(room);
    metrics.roomJoin += 1;
    logEvent('room_joined', {
      roomCode: room.code,
      sessionId: player.sessionId,
      connected: getConnectedPlayerCount(room),
    });

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId, reconnectToken: player.reconnectToken });
  });

  socket.on('room:rejoin', (payload = {}, callback) => {
    const action = 'room:rejoin';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

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

    if(room.party?.forfeits.includes(sessionId)){ackError(callback,'This seat was forfeited.');return;}
    const player = room.players.get(sessionId);
    if (player?.accountId && player.accountId !== socket.data.account?.id) {
      ackError(callback, 'Sign in with the account that joined this room.'); return;
    }

    if (!player) {
      ackError(callback, 'Session not found in room.');
      return;
    }

    const ownsConnection = player.socketId === socket.id && socket.data.roomCode === code && socket.data.sessionId === sessionId;
    const ownsAccount = player.accountId && player.accountId === socket.data.account?.id;
    const suppliedToken = Buffer.from(validatedPayload.reconnectToken || '');
    const expectedToken = Buffer.from(player.reconnectToken || '');
    if (!ownsConnection && !ownsAccount && (!expectedToken.length || suppliedToken.length !== expectedToken.length || !timingSafeEqual(suppliedToken, expectedToken))) {
      ackError(callback, 'Session proof is invalid. Join the room again.');
      return;
    }

    const replacesOwnSeat = socket.data.roomCode === code;
    if (!player.connected && !replacesOwnSeat && getConnectedPlayerCount(room) >= ROOM_CONNECTED_LIMIT) {
      ackError(callback, 'Room is full.');
      return;
    }

    // A repeated rejoin on the current socket must not remove its own player
    // (and delete the room when that player is the only member).
    if (socket.data.roomCode !== code || socket.data.sessionId !== sessionId) {
      leaveBoundRoom(socket);
    }

    if (socket.data.account || validatedPayload.name !== undefined) {
      player.name = sanitizeName(socket.data.account?.name ?? validatedPayload.name);
    }

    if (player.socketId && player.socketId !== socket.id) {
      handleVoiceLeave(room, player);
      const staleSocket = io.sockets.sockets.get(player.socketId);
      if (staleSocket) {
        staleSocket.emit('server:info', {
          message: 'This session was reconnected from another tab.',
        });
        staleSocket.disconnect(true);
      }
    }

    bindSocketToPlayer(socket, room, player);
    ensureHostSession(room);
    // Saved rooms intentionally have no running timers. Resume the phase when
    // a player returns, but never extend an already-running deadline.
    if (room.game && room.game.phase !== 'finished' && !room.game.phaseTimer) {
      syncPhaseTimerForCurrentPhase(room, room.game.phase, 'player_rejoined');
    }
    emitStateToRoom(room);
    metrics.roomRejoin += 1;
    logEvent('room_rejoined', { roomCode: room.code, sessionId: player.sessionId });

    ackOk(callback, { roomCode: room.code, sessionId: player.sessionId, reconnectToken: player.reconnectToken });
  });

  socket.on('room:leave', (payload = {}, callback) => {
    const action = 'room:leave';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, 'room:leave');
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    removePlayerFromRoom(context.room, context.player.sessionId);
    clearSocketBinding(socket);
    metrics.roomLeave += 1;
    logEvent('room_left', {
      roomCode: context.room.code,
      sessionId: context.player.sessionId,
    });

    ackOk(callback, { left: true });
  });

  socket.on('room:prune_disconnected', (payload = {}, callback) => {
    const action = 'room:prune_disconnected';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

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
};
