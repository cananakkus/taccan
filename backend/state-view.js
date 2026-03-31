const { getSortedPlayers } = require('./room-utils');

module.exports = function createStateView(ctx) {
  const { io } = ctx;

  function buildMarksForCard(room, game, cardIndex) {
    const marksForCard = game.marksByCard?.[cardIndex] || new Set();
    const confidenceForCard = game.confidenceByCard?.[cardIndex] || {};
    return [...marksForCard]
      .map((sessionId) => room.players.get(sessionId))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((player) => ({
        sessionId: player.sessionId,
        name: player.name,
        team: player.team,
        confidence: confidenceForCard[player.sessionId] || 'firm',
      }));
  }

  function emitStateToRoom(room) {
    for (const player of room.players.values()) {
      if (!player.connected || !player.socketId) continue;
      const socket = io.sockets.sockets.get(player.socketId);
      if (!socket) continue;
      socket.emit('state:full', buildStateForPlayer(room, player));
    }
  }

  function buildStateForPlayer(room, viewer) {
    const { deriveRoomStatus, getRoomMode, getModeConfig } = ctx.helpers;
    const game = room.game ? buildGameView(room, room.game, viewer) : null;
    return {
      now: Date.now(),
      room: {
        code: room.code,
        status: deriveRoomStatus(room),
        hostSessionId: room.hostSessionId,
        createdAt: room.createdAt,
        mode: getRoomMode(room),
        modeConfig: getModeConfig(getRoomMode(room), room),
        match: room.match ? { id: room.match.id, roundNumber: room.match.roundNumber } : null,
        chatMessages: room.chatMessages,
      },
      me: {
        sessionId: viewer.sessionId, name: viewer.name,
        team: viewer.team, role: viewer.role,
        connected: viewer.connected,
        isHost: room.hostSessionId === viewer.sessionId,
      },
      players: getSortedPlayers(room).map((player) => ({
        sessionId: player.sessionId, name: player.name,
        team: player.team, role: player.role,
        connected: player.connected, joinedAt: player.joinedAt,
        isHost: room.hostSessionId === player.sessionId,
      })),
      game,
    };
  }

  function buildGameView(room, game, viewer) {
    const { getRoomMode, getModeConfig } = ctx.helpers;
    const showKeycard = viewer.role === 'spymaster' || game.phase === 'finished';
    const history = game.history.filter(
      (e) => e.type === 'hint' || e.type === 'guess' || e.type === 'turn_end' || e.type === 'game_end'
    );
    return {
      id: game.id,
      matchId: game.matchId || null,
      roundNumber: Number.isInteger(game.roundNumber) ? game.roundNumber : null,
      phase: game.phase, currentTeam: game.currentTeam,
      startingTeam: game.startingTeam, turnNumber: game.turnNumber,
      mode: game.mode || getRoomMode(room),
      seed: game.seed || null,
      maxHintCount: game.maxHintCount ?? getModeConfig(game.mode || getRoomMode(room), room).maxHintCount,
      phaseTimer: game.phaseTimer
        ? { phase: game.phaseTimer.phase, startedAt: game.phaseTimer.startedAt, endsAt: game.phaseTimer.endsAt, durationMs: game.phaseTimer.durationMs }
        : null,
      hint: game.hint, guessesRemaining: game.guessesRemaining,
      remaining: game.remaining,
      winner: game.winner, loser: game.loser, reason: game.reason,
      showKeycard, history,
      board: game.board.map((card) => {
        const marksForCard = game.marksByCard?.[card.index] || new Set();
        const confidenceForCard = game.confidenceByCard?.[card.index] || {};
        return {
          index: card.index, word: card.word,
          revealed: card.revealed,
          revealedBy: card.revealed ? card.revealedBy : null,
          color: card.revealed || showKeycard ? card.color : null,
          marks: card.revealed ? [] : [...marksForCard]
            .map((sessionId) => room.players.get(sessionId))
            .filter(Boolean)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((player) => ({
              sessionId: player.sessionId, name: player.name,
              team: player.team,
              confidence: confidenceForCard[player.sessionId] || 'firm',
            })),
        };
      }),
    };
  }

  return { buildMarksForCard, emitStateToRoom, buildStateForPlayer, buildGameView };
};
