module.exports = function register(socket, deps) {
  const { io, helpers, voiceInfrastructure } = deps;
  const { preflightAction, getContext, ackOk, ackError, handleVoiceLeave } = helpers;

  function scope(context) {
    return {
      roomId: context.room.code,
      playerId: context.player.sessionId,
      account: socket.data.account ?? null,
      members: [...context.room.players.values()].filter(player => player.connected).map(player => {
        const account = io.sockets.sockets.get(player.socketId)?.data.account;
        return { playerId: player.sessionId, account: account && account.id === player.accountId && account.expires * 1000 > Date.now() ? account : null };
      }),
    };
  }

  async function configuration(context, action) {
    if (socket.data.account && socket.data.account.expires * 1000 <= Date.now()) throw new Error('Your account session expired.');
    const authorization = await voiceInfrastructure.authorize(scope(context));
    const credentials = await voiceInfrastructure.credentials(scope(context));
    const current = getContext(socket, action);
    if (!socket.connected || current?.room !== context.room || current?.player !== context.player) {
      throw new Error('Your room session changed before voice could connect.');
    }
    // Recheck coverage after network I/O; a sponsor may have left meanwhile.
    await voiceInfrastructure.authorize(scope(current));
    const latest = getContext(socket, action);
    if (!socket.connected || latest?.room !== context.room || latest?.player !== context.player) {
      throw new Error('Your room session changed before voice could connect.');
    }
    return { ...credentials, coverage: { allowed: authorization.allowed } };
  }

  socket.on('voice:credentials', async (payload = {}, callback) => {
    if (!preflightAction(socket, 'voice:credentials', payload, callback)) return;
    const context = getContext(socket, 'voice:credentials');
    if (!context?.room.voicePeers?.has(context.player.sessionId)) {
      ackError(callback, 'You are not in voice chat.');
      return;
    }
    try {
      const config = await configuration(context, 'voice:credentials');
      if (!context.room.voicePeers?.has(context.player.sessionId)) throw new Error('You left voice chat.');
      ackOk(callback, config);
    } catch (error) { ackError(callback, error.message); }
  });

  let joining = false;
  let generation = 0;
  socket.on('voice:join', async (payload = {}, callback) => {
    const action = 'voice:join';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (joining) { ackError(callback, 'Voice connection is already in progress.'); return; }
    joining = true;
    const currentGeneration = generation;
    let config;
    try {
      config = await configuration(context, action);
      if (currentGeneration !== generation) throw new Error('Voice connection was cancelled.');
    }
    catch (error) { ackError(callback, error.message); return; }
    finally { joining = false; }

    const { room, player } = context;
    if (!room.voicePeers) room.voicePeers = new Set();

    const existingPeers = [...room.voicePeers].filter((id) => id !== player.sessionId);
    if (room.voicePeers.has(player.sessionId)) {
      ackOk(callback, { peers: existingPeers, ...config });
      return;
    }
    room.voicePeers.add(player.sessionId);
    io.to(room.code).emit('voice:status', { sessionId: player.sessionId, inVoice: true, muted: false, speaking: false });

    for (const peerId of existingPeers) {
      const peer = room.players.get(peerId);
      if (!peer || !peer.connected || !peer.socketId) continue;
      const peerSocket = io.sockets.sockets.get(peer.socketId);
      if (peerSocket) peerSocket.emit('voice:peer_joined', { sessionId: player.sessionId });
    }

    ackOk(callback, { peers: existingPeers, ...config });
  });

  socket.on('voice:leave', (payload = {}, callback) => {
    const action = 'voice:leave';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;
    generation++;

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
    if (!room.voicePeers?.has(player.sessionId) || !room.voicePeers.has(validatedPayload.targetSessionId)) {
      ackError(callback, 'Both players must be in voice chat.');
      return;
    }
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

    if (!room.voiceMuted) room.voiceMuted = new Set();
    if (validatedPayload.muted) {
      room.voiceMuted.add(player.sessionId);
      room.voiceSpeaking?.delete(player.sessionId);
    } else room.voiceMuted.delete(player.sessionId);
    io.to(room.code).emit('voice:status', {
      sessionId: player.sessionId, inVoice: true, muted: validatedPayload.muted,
      speaking: Boolean(room.voiceSpeaking?.has(player.sessionId)),
    });
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
  socket.on('voice:speaking', (payload = {}, callback) => {
    const action = 'voice:speaking';
    const validated = preflightAction(socket, action, payload, callback);
    if (!validated) return;
    const context = getContext(socket, action);
    if (!context?.room.voicePeers?.has(context.player.sessionId)) {
      ackError(callback, 'You are not in voice chat.');
      return;
    }
    const { room, player } = context;
    if (!room.voiceSpeaking) room.voiceSpeaking = new Set();
    const speaking = validated.speaking && !room.voiceMuted?.has(player.sessionId);
    if (speaking !== room.voiceSpeaking.has(player.sessionId)) {
      if (speaking) room.voiceSpeaking.add(player.sessionId);
      else room.voiceSpeaking.delete(player.sessionId);
      io.to(room.code).emit('voice:speaking_changed', { sessionId: player.sessionId, speaking });
    }
    ackOk(callback);
  });
};
