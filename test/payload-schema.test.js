const test = require('node:test');
const assert = require('node:assert/strict');

const { validatePayload } = require('../backend/payload-schema');

test('validatePayload accepts valid gameplay payloads', () => {
  const hint = validatePayload('turn:hint_submit', { word: 'river', count: 2 });
  assert.equal(hint.ok, true);
  assert.deepEqual(hint.value, { word: 'river', count: 2 });

  const join = validatePayload('room:join', { code: 'ABCD', name: 'Agent 1' });
  assert.equal(join.ok, true);
  assert.equal(join.value.code, 'ABCD');

  const rematch = validatePayload('game:rematch', { mode: 'swap_teams' });
  assert.equal(rematch.ok, true);
  assert.deepEqual(rematch.value, { mode: 'swap_teams' });

  const roomMode = validatePayload('room:mode_set', { mode: 'blitz' });
  assert.equal(roomMode.ok, true);
  assert.deepEqual(roomMode.value, { mode: 'blitz' });
});

test('validatePayload rejects wrong shape and types', () => {
  const notObject = validatePayload('room:join', 'ABCD');
  assert.equal(notObject.ok, false);

  const missingRequired = validatePayload('room:rejoin', { code: 'ABCD' });
  assert.equal(missingRequired.ok, false);

  const badEnum = validatePayload('team:set', { team: 'green' });
  assert.equal(badEnum.ok, false);

  const badRoomMode = validatePayload('room:mode_set', { mode: 'ranked' });
  assert.equal(badRoomMode.ok, false);

  const badInteger = validatePayload('turn:guess', { index: 2.4 });
  assert.equal(badInteger.ok, false);
});
