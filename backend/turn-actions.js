const { resolveGuess, advanceTurn, toggleCardMark } = require('./game-engine');

// State changes for validated turn actions. Socket handlers and server-side bots
// both go through these, so a bot move is indistinguishable from a human one.
module.exports = function createTurnActions(ctx) {
  const { io } = ctx;

  function applyHint(room, player, word, count) {
    const { syncPhaseTimerForCurrentPhase, emitStateToRoom } = ctx.helpers;
    const game = room.game;
    game.hint = { word, count, team: player.team, by: player.sessionId, at: Date.now() };
    game.phase = 'guess';
    game.guessesRemaining = count + 1;
    game.history.push({ type: 'hint', by: player.sessionId, team: player.team, word, count, at: Date.now() });
    game.lastActionAt = Date.now();
    room.lastActiveAt = game.lastActionAt;
    io.to(room.code).emit('turn:hint_accepted', { team: game.currentTeam, hint: game.hint });
    syncPhaseTimerForCurrentPhase(room, game.phase, 'hint_submitted');
    emitStateToRoom(room);
  }

  function applyGuess(room, player, card) {
    const { syncPhaseTimerForCurrentPhase, clearPhaseTimerState, scheduleMvpTimeout, emitStateToRoom } = ctx.helpers;
    const game = room.game;
    const phaseBeforeGuess = game.phase;
    const result = resolveGuess(game, player, card);
    room.lastActiveAt = Date.now();
    io.to(room.code).emit('turn:guess_resolved', {
      index: card.index, color: card.color, team: player.team, outcome: result.outcome, finished: game.phase === 'finished',
    });
    if (game.phase === 'finished') {
      io.to(room.code).emit('game:finished', { winner: game.winner, loser: game.loser, reason: game.reason });
      clearPhaseTimerState(room);
      scheduleMvpTimeout(room);
    } else {
      if (result.endedTurn) io.to(room.code).emit('turn:ended', { reason: result.turnEndReason || result.outcome, nextTeam: game.currentTeam });
      if (phaseBeforeGuess !== game.phase) syncPhaseTimerForCurrentPhase(room, game.phase, 'phase_changed_after_guess');
    }
    emitStateToRoom(room);
    return result;
  }

  function applyEndTurn(room) {
    const { syncPhaseTimerForCurrentPhase, emitStateToRoom } = ctx.helpers;
    const game = room.game;
    advanceTurn(game, 'player_ended');
    room.lastActiveAt = Date.now();
    io.to(room.code).emit('turn:ended', { reason: 'player_ended', nextTeam: game.currentTeam });
    syncPhaseTimerForCurrentPhase(room, game.phase, 'player_ended');
    emitStateToRoom(room);
  }

  // `touch: false` leaves lastActionAt alone, so a bot's suggestion mark does not
  // count as teammate activity.
  function applyMark(room, player, index, { touch = true } = {}) {
    const game = room.game;
    const marked = toggleCardMark(game, player.sessionId, index);
    if (marked === null) return null;
    if (touch) game.lastActionAt = Date.now();
    game.history.push({ type: 'mark_toggle', by: player.sessionId, team: player.team, index, marked, at: Date.now() });
    room.lastActiveAt = Date.now();
    io.to(room.code).emit('turn:mark_toggled', { index, by: player.sessionId, marked });
    io.to(room.code).emit('turn:mark_update', { index, marks: ctx.helpers.buildMarksForCard(room, game, index) });
    return marked;
  }

  return { applyHint, applyGuess, applyEndTurn, applyMark };
};
