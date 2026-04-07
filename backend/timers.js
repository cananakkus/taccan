const { randomUUID } = require('crypto');
const { advanceTurn } = require('./game-engine');

module.exports = function createTimers(ctx) {
  const { rooms, io, phaseTimers, mvpTimers, metrics } = ctx;

  function clearPhaseTimer(roomCode) {
    const timer = phaseTimers.get(roomCode);
    if (timer) { clearTimeout(timer); phaseTimers.delete(roomCode); }
  }

  function clearPhaseTimerState(room) {
    if (!room) return;
    clearPhaseTimer(room.code);
    if (room.game && room.game.phaseTimer) room.game.phaseTimer = null;
  }

  function syncPhaseTimerForCurrentPhase(room, phase, reason = 'phase_changed') {
    if (!room || !room.game || room.game.phase === 'finished') {
      clearPhaseTimerState(room);
      return false;
    }
    const game = room.game;
    const currentPhase = game.phase;
    if ((phase || currentPhase) !== currentPhase) return false;

    clearPhaseTimer(room.code);
    const { getRoomMode, getModeConfig, logEvent } = ctx.helpers;
    const modeConfig = getModeConfig(game.mode || getRoomMode(room), room);
    const durationMs = currentPhase === 'hint' ? modeConfig.hintTimerMs : modeConfig.guessTimerMs;
    if (!Number.isInteger(durationMs) || durationMs <= 0) {
      game.phaseTimer = null;
      return false;
    }

    const startedAt = Date.now();
    const endsAt = startedAt + durationMs;
    const timerId = randomUUID();
    game.phaseTimer = { id: timerId, phase: currentPhase, startedAt, endsAt, durationMs };

    const timer = setTimeout(() => finalizePhaseTimer(room.code, timerId), Math.max(durationMs, 1));
    if (typeof timer.unref === 'function') timer.unref();
    phaseTimers.set(room.code, timer);

    io.to(room.code).emit('turn:timer_started', {
      roomCode: room.code, phase: currentPhase, startedAt, endsAt, durationMs,
    });
    metrics.turnTimerStarted += 1;
    logEvent('turn_timer_started', { roomCode: room.code, phase: currentPhase, endsAt, reason });
    return true;
  }

  function finalizePhaseTimer(roomCode, timerId) {
    const room = rooms.get(roomCode);
    clearPhaseTimer(roomCode);
    if (!room || !room.game || room.game.phase === 'finished') return;

    const game = room.game;
    const phaseTimer = game.phaseTimer;
    if (!phaseTimer || phaseTimer.id !== timerId) return;

    const expiredPhase = phaseTimer.phase;
    if (game.phase !== expiredPhase) { game.phaseTimer = null; return; }

    game.phaseTimer = null;
    const timeoutReason = expiredPhase === 'hint' ? 'hint_timeout' : 'guess_timeout';
    advanceTurn(game, timeoutReason);
    room.lastActiveAt = Date.now();

    io.to(room.code).emit('turn:timer_expired', {
      roomCode: room.code, phase: expiredPhase, outcome: timeoutReason, nextTeam: game.currentTeam,
    });
    io.to(room.code).emit('turn:ended', { reason: timeoutReason, nextTeam: game.currentTeam });

    metrics.turnTimerExpired += 1;
    const { logEvent, emitStateToRoom } = ctx.helpers;
    logEvent('turn_timer_expired', {
      roomCode: room.code, phase: expiredPhase, outcome: timeoutReason, nextTeam: game.currentTeam,
    });

    syncPhaseTimerForCurrentPhase(room, game.phase, timeoutReason);
    emitStateToRoom(room);
  }

  // ── MVP Helpers ──

  function broadcastMvpResult(room) {
    if (!room.game || !room.game.mvpVotes) return;
    const votes = room.game.mvpVotes;
    const tally = {};
    for (const targetId of Object.values(votes)) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
    let maxVotes = 0;
    let winnerId = null;
    for (const [id, count] of Object.entries(tally)) {
      if (count > maxVotes) { maxVotes = count; winnerId = id; }
    }
    const winner = winnerId ? room.players.get(winnerId) : null;
    io.to(room.code).emit('game:mvp_result', {
      winner: winner ? { sessionId: winner.sessionId, name: winner.name } : null,
      votes: tally,
    });
  }

  function scheduleMvpTimeout(room) {
    clearMvpTimer(room.code);
    const timer = setTimeout(() => {
      mvpTimers.delete(room.code);
      broadcastMvpResult(room);
    }, ctx.constants.MVP_TIMEOUT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    mvpTimers.set(room.code, timer);
  }

  function clearMvpTimer(roomCode) {
    const timer = mvpTimers.get(roomCode);
    if (timer) { clearTimeout(timer); mvpTimers.delete(roomCode); }
  }

  return {
    clearPhaseTimer, clearPhaseTimerState,
    syncPhaseTimerForCurrentPhase, finalizePhaseTimer,
    broadcastMvpResult, scheduleMvpTimeout, clearMvpTimer,
  };
};
