const { randomUUID, randomBytes } = require('node:crypto');

// Hosts can seat computer players in normal rooms, so a short table (or a
// single person) can still play. Party rooms take their bots from the hub.
const BOT_NAMES = ['Atlas', 'Cipher', 'Echo', 'Vesper', 'Quill', 'Orion', 'Juno', 'Nova', 'Sable', 'Rook', 'Wren', 'Onyx'];
const MAX_BOTS = 6;

module.exports = function register(socket, deps) {
  const { helpers, constants } = deps;
  const { preflightAction, getContext, ackOk, ackError, emitStateToRoom, clearMarksForSession } = helpers;
  const { getConnectedPlayerCount } = require('../room-utils');

  function hostContext(action, callback) {
    const context = getContext(socket, action);
    if (!context) { ackError(callback, 'You are not in a room.'); return null; }
    if (context.room.hostSessionId !== context.player.sessionId) { ackError(callback, 'Only the host can seat or remove bots.'); return null; }
    return context;
  }

  socket.on('room:bot_add', (payload = {}, callback) => {
    const action = 'room:bot_add';
    const body = preflightAction(socket, action, payload, callback);
    if (!body) return;
    const context = hostContext(action, callback);
    if (!context) return;
    const { room } = context;
    const players = [...room.players.values()];
    if (players.filter((p) => p.bot).length >= MAX_BOTS) { ackError(callback, `A room can seat at most ${MAX_BOTS} bots.`); return; }
    if (getConnectedPlayerCount(room) >= constants.ROOM_CONNECTED_LIMIT) { ackError(callback, 'Room is full.'); return; }
    const used = new Set(players.map((p) => p.name));
    const name = BOT_NAMES.find((candidate) => !used.has(candidate)) || `Bot ${players.length + 1}`;
    const hasSpymaster = players.some((p) => p.team === body.team && p.role === 'spymaster');
    const now = Date.now();
    const bot = {
      sessionId: randomUUID(),
      reconnectToken: randomBytes(32).toString('base64url'),
      socketId: null,
      name,
      team: body.team,
      role: hasSpymaster ? 'operative' : 'spymaster',
      connected: true,
      joinedAt: now,
      lastSeenAt: now,
      bot: true,
      skill: body.skill || 'normal',
    };
    room.players.set(bot.sessionId, bot);
    room.lastActiveAt = now;
    emitStateToRoom(room);
    ackOk(callback, { sessionId: bot.sessionId, name: bot.name, role: bot.role });
  });

  socket.on('room:bot_remove', (payload = {}, callback) => {
    const action = 'room:bot_remove';
    const body = preflightAction(socket, action, payload, callback);
    if (!body) return;
    const context = hostContext(action, callback);
    if (!context) return;
    const { room } = context;
    const bot = room.players.get(body.sessionId);
    if (!bot?.bot) { ackError(callback, 'That bot is not in this room.'); return; }
    clearMarksForSession(room, bot.sessionId);
    room.players.delete(bot.sessionId);
    room.lastActiveAt = Date.now();
    emitStateToRoom(room);
    ackOk(callback, { removed: true });
  });
};

module.exports.MAX_BOTS = MAX_BOTS;
module.exports.BOT_NAMES = BOT_NAMES;
