module.exports = function register(socket, deps) {
  const { helpers, constants } = deps;
  const { preflightAction, getContext, ackOk, ackError, emitStateToRoom } = helpers;
  const { TEAM_VALUES, ROLE_VALUES } = constants;

  socket.on('team:set', (payload = {}, callback) => {
    const action = 'team:set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const team = String(validatedPayload.team || '').toLowerCase().trim();
    if (!TEAM_VALUES.has(team)) {
      ackError(callback, 'Invalid team value.');
      return;
    }

    context.player.team = team;

    if (team === 'none') {
      context.player.role = 'spectator';
    } else if (context.player.role === 'spectator') {
      context.player.role = 'operative';
    }

    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);

    ackOk(callback, { team: context.player.team, role: context.player.role });
  });

  socket.on('role:set', (payload = {}, callback) => {
    const action = 'role:set';
    const validatedPayload = preflightAction(socket, action, payload, callback);
    if (!validatedPayload) return;

    const context = getContext(socket, action);
    if (!context) {
      ackError(callback, 'You are not in a room.');
      return;
    }

    const role = String(validatedPayload.role || '').toLowerCase().trim();
    if (!ROLE_VALUES.has(role)) {
      ackError(callback, 'Invalid role value.');
      return;
    }

    if (role === 'spectator') {
      context.player.role = 'spectator';
      context.player.team = 'none';
    } else {
      if (context.player.team === 'none') {
        const activeGame =
          context.room.game && context.room.game.phase !== 'finished' ? context.room.game : null;
        context.player.team = activeGame ? activeGame.currentTeam : 'red';
      }

      context.player.role = role;
    }

    context.room.lastActiveAt = Date.now();
    emitStateToRoom(context.room);

    ackOk(callback, { team: context.player.team, role: context.player.role });
  });
};
