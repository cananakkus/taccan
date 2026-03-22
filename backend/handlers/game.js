module.exports = function register(socket, deps) {
  const { metrics, helpers } = deps;
  const {
    preflightAction, getContext, ackOk, ackError, sendViolation, logEvent,
    isGameActive, validateRoomReadiness, startNewRound, swapRoomTeams,
  } = helpers;

  socket.on('game:start', (payload = {}, callback) => {
    const action = 'game:start';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

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
    if (!validatedPayload) return;

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

    const startedGame = startNewRound(
      context.room,
      mode === 'swap_teams' ? 'rematch_swap' : 'rematch'
    );
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
};
