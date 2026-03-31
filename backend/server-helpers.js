const { validatePayload } = require('./payload-schema');
const { ensureHostSession } = require('./room-utils');

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

module.exports = function createServerHelpers(ctx) {
  const { rooms, io, metrics } = ctx;

  function logEvent(event, fields = {}) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
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
      ctx.helpers.emitStateToRoom(room);
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
      ctx.helpers.clearPhaseTimerState(room);
      logEvent('room_deleted', { roomCode: room.code, reason: 'empty' });
      rooms.delete(room.code);
      return;
    }
    ctx.helpers.emitStateToRoom(room);
  }

  function clearMarksForSession(room, sessionId) {
    if (!room.game || !room.game.marksByCard) return;
    for (const marks of room.game.marksByCard) marks.delete(sessionId);
  }

  return {
    preflightAction, consumeRateLimit, getContext,
    bindSocketToPlayer, clearSocketBinding,
    leaveBoundRoom, handleVoiceLeave,
    markDisconnected, removePlayerFromRoom, clearMarksForSession,
    sendViolation, ackOk, ackError, logEvent,
  };
};
