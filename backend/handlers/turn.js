const { BOARD_SIZE, normalizeHint, setCardConfidence } = require('../game-engine');

module.exports = function register(socket, deps) {
  const { io, helpers } = deps;
  const {
    preflightAction, getContext, ackOk, ackError, sendViolation,
    getRoomMode, getModeConfig, buildMarksForCard, withContextLock,
    applyHint, applyGuess, applyEndTurn, applyMark,
  } = helpers;

  socket.on('turn:hint_submit', (payload = {}, callback) => {
    const action = 'turn:hint_submit';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    withContextLock(socket, action, callback, (context) => {
      const game = context.room.game;
      if (!game || game.phase === 'finished') {
        ackError(callback, 'No active game.');
        return;
      }

      if (game.phase !== 'hint') {
        sendViolation(socket, 'turn:hint_submit', 'Hints are closed. Wait for the next hint phase.');
        ackError(callback, 'Hints are closed. Wait for the next hint phase.');
        return;
      }

      if (context.player.team !== game.currentTeam || context.player.role !== 'spymaster') {
        sendViolation(socket, 'turn:hint_submit', 'Only the active team spymaster can submit a hint.');
        ackError(callback, 'Only the active team spymaster can submit a hint.');
        return;
      }

      const hintWord = normalizeHint(validatedPayload.word);
      const count = Number(validatedPayload.count);
      const modeConfig = getModeConfig(game.mode || getRoomMode(context.room), context.room);
      const maxHintCount = game.maxHintCount ?? modeConfig.maxHintCount;

      if (!hintWord) {
        ackError(callback, 'Hint word is required.');
        return;
      }

      const hintUpper = hintWord.toUpperCase();
      if (game.board.some((c) => !c.revealed && c.word.normalize('NFC').toUpperCase() === hintUpper)) {
        ackError(callback, 'Your hint cannot be a word on the board.');
        return;
      }

      if (!Number.isInteger(count) || count < 1 || (maxHintCount !== null && count > maxHintCount)) {
        ackError(
          callback,
          `Hint count must be an integer from 1${maxHintCount !== null ? ` to ${maxHintCount}` : ''}.`
        );
        return;
      }

      applyHint(context.room, context.player, hintWord, count);
      ackOk(callback, { accepted: true });
    });
  });

  socket.on('turn:mark_toggle', (payload = {}, callback) => {
    const action = 'turn:mark_toggle';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const game = context.room.game;
    if (!game || game.phase === 'finished') {
      ackError(callback, 'No active game.');
      return;
    }

    if (game.phase !== 'guess') {
      ackError(callback, 'Marking is only available during guess phase.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
      sendViolation(socket, 'turn:mark_toggle', 'Only active-team operatives can mark words.');
      ackError(callback, 'Only active-team operatives can mark words.');
      return;
    }

    const index = Number(validatedPayload.index);
    if (!Number.isInteger(index) || index < 0 || index > BOARD_SIZE - 1) {
      ackError(callback, `Card index must be between 0 and ${BOARD_SIZE - 1}.`);
      return;
    }

    const card = game.board[index];
    if (card.revealed) {
      ackError(callback, 'Cannot mark a revealed card.');
      return;
    }

    const marked = applyMark(context.room, context.player, index);
    if (marked === null) {
      ackError(callback, 'Card mark state unavailable.');
      return;
    }

    ackOk(callback, { index, marked });
  });

  socket.on('turn:guess', (payload = {}, callback) => {
    const action = 'turn:guess';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    withContextLock(socket, action, callback, (context) => {
      const game = context.room.game;
      if (!game || game.phase === 'finished') {
        ackError(callback, 'No active game.');
        return;
      }

      if (game.phase !== 'guess') {
        sendViolation(socket, 'turn:guess', 'Guessing is not open right now.');
        ackError(callback, 'Guessing is not open right now.');
        return;
      }

      if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
        sendViolation(socket, 'turn:guess', 'Only operatives on the active team may guess.');
        ackError(callback, 'Only operatives on the active team may guess.');
        return;
      }

      const index = Number(validatedPayload.index);
      if (!Number.isInteger(index) || index < 0 || index > BOARD_SIZE - 1) {
        ackError(callback, `Card index must be between 0 and ${BOARD_SIZE - 1}.`);
        return;
      }

      const card = game.board[index];
      if (card.revealed) {
        ackError(callback, 'This card has already been revealed.');
        return;
      }

      const result = applyGuess(context.room, context.player, card);
      ackOk(callback, result);
    });
  });

  socket.on('turn:end', (payload = {}, callback) => {
    const action = 'turn:end';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    withContextLock(socket, action, callback, (context) => {
      const game = context.room.game;
      if (!game || game.phase === 'finished') {
        ackError(callback, 'No active game.');
        return;
      }

      if (game.phase !== 'guess') {
        ackError(callback, 'You can only end turn during guess phase.');
        return;
      }

      if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
        sendViolation(socket, 'turn:end', 'Only active team operatives can end the turn.');
        ackError(callback, 'Only active team operatives can end the turn.');
        return;
      }

      applyEndTurn(context.room);
      ackOk(callback, { ended: true });
    });
  });

  socket.on('game:gg', (payload = {}, callback) => {
    const action = 'game:gg';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    if (!context.room.game || context.room.game.phase !== 'finished') {
      ackError(callback, 'GG is only available after game finishes.');
      return;
    }

    io.to(context.room.code).emit('game:gg_received', {
      sessionId: context.player.sessionId,
      name: context.player.name,
    });

    ackOk(callback, { sent: true });
  });

  socket.on('turn:mark_confidence', (payload = {}, callback) => {
    const action = 'turn:mark_confidence';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const game = context.room.game;
    if (!game || game.phase !== 'guess') {
      ackError(callback, 'Confidence marking is only available during guess phase.');
      return;
    }

    if (context.player.team !== game.currentTeam || context.player.role !== 'operative') {
      ackError(callback, 'Only active-team operatives can set confidence.');
      return;
    }

    const index = Number(validatedPayload.index);
    if (!Number.isInteger(index) || index < 0 || index > BOARD_SIZE - 1) {
      ackError(callback, `Card index must be between 0 and ${BOARD_SIZE - 1}.`);
      return;
    }

    if (game.board[index].revealed || !game.marksByCard[index]?.has(context.player.sessionId)) {
      ackError(callback, 'Mark an unrevealed card before setting confidence.');
      return;
    }
    setCardConfidence(game, context.player.sessionId, index, validatedPayload.confidence);
    game.lastActionAt = Date.now();
    context.room.lastActiveAt = game.lastActionAt;

    io.to(context.room.code).emit('turn:mark_update', {
      index,
      marks: buildMarksForCard(context.room, game, index),
    });
    ackOk(callback, { index, confidence: validatedPayload.confidence });
  });
};
