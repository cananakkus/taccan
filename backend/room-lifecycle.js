const { randomUUID } = require('crypto');
const { createGameState } = require('./game-engine');
const { getRoomReadinessError } = require('./room-utils');

module.exports = function createRoomLifecycle(ctx) {
  const { rooms, io, metrics } = ctx;

  function sanitizeName(value) {
    const normalized = String(value || '').trim().replace(/\s+/g, ' ').slice(0, ctx.constants.PLAYER_NAME_MAX);
    return normalized || `Player-${Math.floor(Math.random() * 900 + 100)}`;
  }

  function createPlayer(name, socketId) {
    return {
      sessionId: randomUUID(),
      socketId,
      name: sanitizeName(name),
      team: 'none',
      role: 'spectator',
      connected: true,
      joinedAt: Date.now(),
      lastSeenAt: Date.now(),
    };
  }

  function createRoomCode() {
    const { ROOM_CODE_ALPHABET, MAX_ROOM_CODE_ATTEMPTS } = ctx.constants;
    for (let attempt = 0; attempt < MAX_ROOM_CODE_ATTEMPTS; attempt += 1) {
      let code = '';
      for (let i = 0; i < 4; i += 1) {
        code += ROOM_CODE_ALPHABET[Math.floor(Math.random() * ROOM_CODE_ALPHABET.length)];
      }
      if (!rooms.has(code)) return code;
    }
    throw new Error(`Failed to generate unique room code after ${MAX_ROOM_CODE_ATTEMPTS} attempts.`);
  }

  function getNormalizedMode(value) {
    const normalized = String(value || '').toLowerCase().trim();
    return ctx.constants.ROOM_MODE_VALUES.has(normalized) ? normalized : 'casual';
  }

  function getRoomMode(room) {
    if (!room) return 'casual';
    const normalized = getNormalizedMode(room.mode);
    if (room.mode !== normalized) room.mode = normalized;
    return normalized;
  }

  function getModeConfig(mode, room) {
    const normalizedMode = getNormalizedMode(mode);
    const config = { ...(ctx.constants.MODE_CONFIG[normalizedMode] || ctx.constants.MODE_CONFIG.casual) };
    if (normalizedMode === 'blitz' && room && room.blitzConfig) {
      if (Number.isInteger(room.blitzConfig.hintTimerMs) && room.blitzConfig.hintTimerMs > 0) {
        config.hintTimerMs = room.blitzConfig.hintTimerMs;
      }
      if (Number.isInteger(room.blitzConfig.guessTimerMs) && room.blitzConfig.guessTimerMs > 0) {
        config.guessTimerMs = room.blitzConfig.guessTimerMs;
      }
    }
    return config;
  }

  function isGameActive(room) {
    return Boolean(room.game && room.game.phase !== 'finished');
  }

  function validateRoomReadiness(room) {
    return getRoomReadinessError(room);
  }

  function deriveRoomStatus(room) {
    if (!room.game) return 'lobby';
    if (room.game.phase === 'finished') return 'finished';
    return 'in_game';
  }

  function startNewRound(room, trigger = 'manual') {
    const { clearPhaseTimerState, clearMvpTimer, syncPhaseTimerForCurrentPhase, emitStateToRoom, logEvent } = ctx.helpers;
    clearPhaseTimerState(room);
    clearMvpTimer(room.code);
    const match = getNextMatch(room);
    const roomMode = getRoomMode(room);
    const modeConfig = getModeConfig(roomMode, room);
    room.match = match;
    room.game = createGameState({
      matchId: match.id,
      roundNumber: match.roundNumber,
      mode: roomMode,
      maxHintCount: modeConfig.maxHintCount,
      customWords: room.customWords || null,
    });
    room.lastActiveAt = Date.now();

    io.to(room.code).emit('game:started', {
      roomCode: room.code,
      startingTeam: room.game.startingTeam,
      matchId: room.game.matchId,
      roundNumber: room.game.roundNumber,
      mode: room.game.mode,
      maxHintCount: room.game.maxHintCount,
      trigger,
    });

    syncPhaseTimerForCurrentPhase(room, room.game.phase, `round_started:${trigger}`);
    emitStateToRoom(room);
    metrics.gameStart += 1;
    logEvent('game_started', {
      roomCode: room.code, trigger,
      startingTeam: room.game.startingTeam,
      matchId: room.game.matchId,
      roundNumber: room.game.roundNumber,
      mode: room.game.mode,
      maxHintCount: room.game.maxHintCount,
    });

    return room.game;
  }

  function getNextMatch(room) {
    if (room.match && room.match.id && Number.isInteger(room.match.roundNumber)) {
      return { id: room.match.id, roundNumber: room.match.roundNumber + 1 };
    }
    return { id: randomUUID(), roundNumber: 1 };
  }

  function swapRoomTeams(room) {
    for (const player of room.players.values()) {
      if (player.team === 'red') { player.team = 'blue'; continue; }
      if (player.team === 'blue') { player.team = 'red'; }
    }
  }

  function isPrivateIP(ip) {
    const parts = ip.split('.').map(Number);
    if (parts.length === 4) {
      if (parts[0] === 10) return true;
      if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
      if (parts[0] === 192 && parts[1] === 168) return true;
      if (parts[0] === 127) return true;
      if (parts[0] === 169 && parts[1] === 254) return true;
      if (parts[0] === 0) return true;
    }
    if (ip === '::1' || ip.startsWith('fe80:') || ip.startsWith('fc') || ip.startsWith('fd')) return true;
    return false;
  }

  async function fetchWordPack(url) {
    const https = require('https');
    const dns = require('dns');
    const safeLookup = (hostname, opts, cb) => {
      dns.lookup(hostname, opts, (err, address, family) => {
        if (err) return cb(err);
        if (isPrivateIP(address)) return cb(new Error('URL resolves to a private/internal address.'));
        cb(null, address, family);
      });
    };
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 10_000, lookup: safeLookup }, (res) => {
        if (res.statusCode !== 200) { reject(new Error(`HTTP ${res.statusCode}`)); res.resume(); return; }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            const words = JSON.parse(data);
            if (!Array.isArray(words) || words.length < 50) {
              reject(new Error('Word pack must be a JSON array with at least 50 strings.'));
              return;
            }
            const validated = words.filter((w) => typeof w === 'string' && w.trim().length > 0).map((w) => w.trim());
            if (validated.length < 50) { reject(new Error('Word pack must contain at least 50 valid strings.')); return; }
            resolve(validated);
          } catch (_e) { reject(new Error('Invalid JSON.')); }
        });
      });
      req.on('error', (e) => reject(e));
      req.on('timeout', () => { req.destroy(); reject(new Error('Timeout.')); });
    });
  }

  return {
    sanitizeName, createPlayer, createRoomCode,
    getNormalizedMode, getRoomMode, getModeConfig,
    isGameActive, validateRoomReadiness, deriveRoomStatus,
    startNewRound, getNextMatch, swapRoomTeams,
    isPrivateIP, fetchWordPack,
  };
};
