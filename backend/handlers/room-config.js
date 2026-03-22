module.exports = function register(socket, deps) {
  const { metrics, helpers, constants } = deps;
  const {
    preflightAction, getContext, ackOk, ackError, sendViolation,
    emitStateToRoom, logEvent,
    isGameActive, getNormalizedMode, getRoomMode, getModeConfig, fetchWordPack,
  } = helpers;
  const { ROOM_MODE_VALUES } = constants;

  socket.on('room:mode_set', (payload = {}, callback) => {
    const action = 'room:mode_set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

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
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }
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

    const roomCode = context.room.code;
    fetchWordPack(url)
      .then((words) => {
        const room = deps.rooms.get(roomCode);
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
};
