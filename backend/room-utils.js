function getSortedPlayers(room) {
  return [...room.players.values()].sort((a, b) => a.joinedAt - b.joinedAt);
}

function getConnectedPlayerCount(room) {
  let count = 0;
  for (const player of room.players.values()) {
    if (player.connected) {
      count += 1;
    }
  }

  return count;
}

function getConnectedTeamPlayers(room) {
  const teamPlayers = [];
  for (const player of room.players.values()) {
    if (!player.connected) {
      continue;
    }

    if (player.team === 'none' || player.role === 'spectator') {
      continue;
    }

    teamPlayers.push(player);
  }

  return teamPlayers;
}

function getConnectedPlayersCountGlobal(rooms) {
  let count = 0;
  for (const room of rooms.values()) {
    count += getConnectedPlayerCount(room);
  }

  return count;
}

function getNextHost(room) {
  const sortedPlayers = getSortedPlayers(room);
  const connectedPlayer = sortedPlayers.find((player) => player.connected);
  if (connectedPlayer) {
    return connectedPlayer;
  }

  return sortedPlayers[0] || null;
}

function ensureHostSession(room) {
  if (!room.hostSessionId) {
    const nextHost = getNextHost(room);
    room.hostSessionId = nextHost ? nextHost.sessionId : null;
    return;
  }

  const currentHost = room.players.get(room.hostSessionId);
  if (currentHost && currentHost.connected) {
    return;
  }

  const nextHost = getNextHost(room);
  room.hostSessionId = nextHost ? nextHost.sessionId : null;
}

function pruneDisconnectedPlayers(room, now, ttlMs, clearMarksForSession, options = {}) {
  const force = Boolean(options.force);
  let removedCount = 0;

  for (const player of room.players.values()) {
    const expired = !player.connected && now - player.lastSeenAt > ttlMs;
    if (!player.connected && (force || expired)) {
      if (typeof clearMarksForSession === 'function') {
        clearMarksForSession(room, player.sessionId);
      }

      room.players.delete(player.sessionId);
      removedCount += 1;
    }
  }

  if (removedCount > 0) {
    room.lastActiveAt = now;
  }

  return removedCount;
}

function getRoomReadinessError(room) {
  if (getConnectedPlayerCount(room) < 1) {
    return 'At least one connected player is required to start.';
  }

  const connectedTeamPlayers = getConnectedTeamPlayers(room);
  if (connectedTeamPlayers.length < 1) {
    return 'At least one connected team player is required to start.';
  }

  return null;
}

module.exports = {
  getSortedPlayers,
  getConnectedPlayerCount,
  getConnectedTeamPlayers,
  getConnectedPlayersCountGlobal,
  ensureHostSession,
  pruneDisconnectedPlayers,
  getRoomReadinessError,
};
