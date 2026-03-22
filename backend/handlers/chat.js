const CHAT_MAX_MESSAGES = 200;

module.exports = function register(socket, deps) {
  const { helpers } = deps;
  const { preflightAction, getContext, ackOk, ackError } = helpers;

  socket.on('chat:send', (payload = {}, callback) => {
    const action = 'chat:send';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const text = String(validatedPayload.text).trim();
    if (!text) {
      ackError(callback, 'Message cannot be empty.');
      return;
    }

    const message = {
      sessionId: context.player.sessionId,
      name: context.player.name,
      team: context.player.team,
      text,
      ts: Date.now(),
    };

    context.room.chatMessages.push(message);
    if (context.room.chatMessages.length > CHAT_MAX_MESSAGES) {
      context.room.chatMessages.splice(0, context.room.chatMessages.length - CHAT_MAX_MESSAGES);
    }

    deps.io.to(context.room.code).emit('chat:message', message);
    ackOk(callback, { sent: true });
  });
};
