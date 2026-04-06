const { BOARD_SIZE } = require('./game-engine');

const SCHEMAS = {
  'room:create': {
    name: { type: 'string', optional: true, maxLength: 200 },
  },
  'room:join': {
    code: { type: 'string', optional: false, maxLength: 32 },
    name: { type: 'string', optional: true, maxLength: 200 },
  },
  'room:rejoin': {
    code: { type: 'string', optional: false, maxLength: 32 },
    sessionId: { type: 'string', optional: false, maxLength: 128 },
    name: { type: 'string', optional: true, maxLength: 200 },
  },
  'room:leave': {},
  'room:prune_disconnected': {},
  'room:mode_set': {
    mode: { type: 'string', optional: false, enum: ['casual', 'blitz'] },
  },
  'room:blitz_config': {
    hintTimerSec: { type: 'integer', optional: false, min: 5, max: 300 },
    guessTimerSec: { type: 'integer', optional: false, min: 5, max: 300 },
  },
  'room:word_pack_set': {
    url: { type: 'string', optional: false, maxLength: 2048 },
  },
  'team:set': {
    team: { type: 'string', optional: false, enum: ['red', 'blue', 'none'] },
  },
  'role:set': {
    role: { type: 'string', optional: false, enum: ['spymaster', 'operative', 'spectator'] },
  },
  'game:start': {},
  'game:rematch': {
    mode: { type: 'string', optional: false, enum: ['same_teams', 'swap_teams'] },
  },
  'game:gg': {},
  'game:mvp_vote': {
    targetSessionId: { type: 'string', optional: false, maxLength: 128 },
  },
  'turn:hint_submit': {
    word: { type: 'string', optional: false, maxLength: 64 },
    count: { type: 'integer', optional: false, min: 1, max: 50 },
  },
  'turn:mark_toggle': {
    index: { type: 'integer', optional: false, min: 0, max: BOARD_SIZE - 1 },
  },
  'turn:mark_confidence': {
    index: { type: 'integer', optional: false, min: 0, max: BOARD_SIZE - 1 },
    confidence: { type: 'string', optional: false, enum: ['firm', 'tentative'] },
  },
  'turn:guess': {
    index: { type: 'integer', optional: false, min: 0, max: BOARD_SIZE - 1 },
  },
  'turn:end': {},
  'voice:join': {},
  'voice:leave': {},
  'voice:signal': {
    targetSessionId: { type: 'string', optional: false, maxLength: 128 },
    type: { type: 'string', optional: false, enum: ['offer', 'answer', 'candidate'] },
    sdp: { type: 'string', optional: true, maxLength: 65536 },
    candidate: { type: 'string', optional: true, maxLength: 4096 },
  },
  'voice:mute': {
    muted: { type: 'boolean', optional: false },
  },
  'chat:send': {
    text: { type: 'string', optional: false, maxLength: 200 },
  },
};

function validatePayload(action, payload) {
  const schema = SCHEMAS[action];
  if (!schema) {
    return { ok: false, error: `No payload schema registered for ${action}.` };
  }

  if (!isPlainObject(payload)) {
    return { ok: false, error: 'Payload must be an object.' };
  }

  const normalized = {};
  for (const [field, rules] of Object.entries(schema)) {
    const value = payload[field];
    if (value === undefined || value === null) {
      if (rules.optional) {
        continue;
      }

      return { ok: false, error: `Missing required field: ${field}.` };
    }

    const typeError = checkType(value, rules.type);
    if (typeError) {
      return { ok: false, error: `${field}: ${typeError}` };
    }

    if (rules.type === 'string' && rules.maxLength && String(value).length > rules.maxLength) {
      return { ok: false, error: `${field}: exceeds maximum length ${rules.maxLength}.` };
    }

    if (rules.type === 'integer' || rules.type === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        return { ok: false, error: `${field}: must be >= ${rules.min}.` };
      }
      if (rules.max !== undefined && value > rules.max) {
        return { ok: false, error: `${field}: must be <= ${rules.max}.` };
      }
    }

    if (Array.isArray(rules.enum) && !rules.enum.includes(value)) {
      return { ok: false, error: `${field}: unsupported value.` };
    }

    normalized[field] = value;
  }

  return { ok: true, value: normalized };
}

function checkType(value, type) {
  if (type === 'string') {
    return typeof value === 'string' ? null : 'must be a string';
  }

  if (type === 'number') {
    return typeof value === 'number' && Number.isFinite(value) ? null : 'must be a finite number';
  }

  if (type === 'integer') {
    return Number.isInteger(value) ? null : 'must be an integer';
  }

  if (type === 'boolean') {
    return typeof value === 'boolean' ? null : 'must be a boolean';
  }

  return 'invalid schema definition';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  validatePayload,
};
