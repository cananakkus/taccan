module.exports = function register(socket, deps) {
  const { io, helpers } = deps;
  const { preflightAction, getContext, ackOk, ackError, handleVoiceLeave } = helpers;

  socket.on('voice:join', (payload = {}, callback) => {
    const action = 'voice:join';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const { room, player } = context;
    if (!room.voicePeers) room.voicePeers = new Set();

    const existingPeers = [...room.voicePeers].filter((id) => id !== player.sessionId);
    room.voicePeers.add(player.sessionId);

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
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    handleVoiceLeave(context.room, context.player);
    ackOk(callback);
  });

  socket.on('voice:signal', (payload = {}, callback) => {
    const action = 'voice:signal';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const { room, player } = context;
    const targetPlayer = room.players.get(validatedPayload.targetSessionId);
    if (!targetPlayer || !targetPlayer.connected || !targetPlayer.socketId) {
      ackError(callback, 'Target peer not found.');
      return;
    }

    const targetSocket = io.sockets.sockets.get(targetPlayer.socketId);
    if (!targetSocket) {
      ackError(callback, 'Target peer not connected.');
      return;
    }

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
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

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
      if (peerSocket) {
        peerSocket.emit('voice:mute_changed', {
          sessionId: player.sessionId,
          muted: validatedPayload.muted,
        });
      }
    }

    ackOk(callback);
  });
};
