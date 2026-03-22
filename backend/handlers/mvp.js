module.exports = function register(socket, deps) {
  const { helpers } = deps;
  const { preflightAction, getContext, ackOk, ackError, clearMvpTimer, broadcastMvpResult } = helpers;

  socket.on('game:mvp_vote', (payload = {}, callback) => {
    const action = 'game:mvp_vote';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (!context.room.game || context.room.game.phase !== 'finished') {
      ackError(callback, 'MVP vote is only available after game finishes.');
      return;
    }

    const targetSessionId = String(validatedPayload.targetSessionId || '').trim();
    if (targetSessionId === context.player.sessionId) {
      ackError(callback, 'Cannot vote for yourself.');
      return;
    }

    const targetPlayer = context.room.players.get(targetSessionId);
    if (!targetPlayer) {
      ackError(callback, 'Target player not found.');
      return;
    }

    context.room.game.mvpVotes = context.room.game.mvpVotes || {};
    context.room.game.mvpVotes[context.player.sessionId] = targetSessionId;

    const connectedTeam = [...context.room.players.values()].filter(
      (p) => p.connected && p.team !== 'none' && p.role !== 'spectator'
    );
    const allVoted = connectedTeam.every((p) => context.room.game.mvpVotes[p.sessionId]);

    if (allVoted) {
      clearMvpTimer(context.room.code);
      broadcastMvpResult(context.room);
    }

    ackOk(callback, { voted: true });
  });
};
