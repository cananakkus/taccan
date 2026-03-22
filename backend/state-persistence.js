const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, '..', '.taccan-state.json');

function serializeGame(game) {
  return {
    ...game,
    phaseTimer: null,
    marksByCard: game.marksByCard.map((s) => [...s]),
    confidenceByCard: game.confidenceByCard || null,
  };
}

function saveState(rooms) {
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
        customWords: room.customWords || null,
        players: [...room.players.values()].map((p) => ({
          ...p,
          connected: false,
          socketId: null,
        })),
        game: room.game ? serializeGame(room.game) : null,
      });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(serialized), 'utf8');
    return true;
  } catch (err) {
    console.error('Failed to save state:', err.message);
    return false;
  }
}

function loadState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    const data = fs.readFileSync(STATE_FILE, 'utf8');
    fs.unlinkSync(STATE_FILE);
    return JSON.parse(data);
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
      players.set(p.sessionId, p);
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
