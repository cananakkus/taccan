const fs = require('fs');
const path = require('path');
const { randomBytes } = require('node:crypto');

const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, '..', '.taccan-state.json');

function serializeGame(game) {
  return {
    ...game,
    phaseTimer: null,
    marksByCard: game.marksByCard.map((s) => [...s]),
    confidenceByCard: game.confidenceByCard || null,
  };
}

function saveState(rooms, stateFile = STATE_FILE) {
  try {
    const serialized = [];
    for (const [, room] of rooms) {
      serialized.push({
        code: room.code,
        createdAt: room.createdAt,
        lastActiveAt: room.lastActiveAt,
        hostSessionId: room.hostSessionId,
        mode: room.mode,
        match: room.match,
        chatMessages: room.chatMessages || [],
        blitzConfig: room.blitzConfig || null,
        players: [...room.players.values()].map((p) => ({
          ...p,
          connected: false,
          socketId: null,
          lastSeenAt: p.connected ? Date.now() : p.lastSeenAt,
        })),
        game: room.game ? serializeGame(room.game) : null,
      });
    }
    fs.writeFileSync(`${stateFile}.tmp`, JSON.stringify(serialized), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(`${stateFile}.tmp`, stateFile);
    return true;
  } catch (err) {
    console.error('Failed to save state:', err.message);
    return false;
  }
}

function loadState(stateFile = STATE_FILE) {
  try {
    if (!fs.existsSync(stateFile)) return null;
    const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    fs.unlinkSync(stateFile);
    return data;
  } catch (err) {
    console.error('Failed to load state:', err.message);
    return null;
  }
}

function restoreRooms(serialized) {
  const rooms = new Map();
  if (!Array.isArray(serialized)) return rooms;

  for (const roomData of serialized) {
    const players = new Map();
    for (const p of roomData.players || []) {
      players.set(p.sessionId, { ...p, reconnectToken: p.reconnectToken || randomBytes(32).toString('base64url') });
    }

    const game = roomData.game
      ? {
          ...roomData.game,
          marksByCard: (roomData.game.marksByCard || []).map((arr) => new Set(arr)),
        }
      : null;

    rooms.set(roomData.code, {
      ...roomData,
      players,
      game,
    });
  }
  return rooms;
}

module.exports = { saveState, loadState, restoreRooms };
