const test = require('node:test');
const assert = require('node:assert/strict');
const { withRoomLock } = require('../backend/room-lock');

test('withRoomLock serializes operations on the same room', async () => {
  const order = [];

  const p1 = withRoomLock('ROOM1', () => {
    order.push('start-1');
    order.push('end-1');
  });

  const p2 = withRoomLock('ROOM1', () => {
    order.push('start-2');
    order.push('end-2');
  });

  await Promise.all([p1, p2]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('withRoomLock allows parallel operations on different rooms', async () => {
  const order = [];

  const p1 = withRoomLock('ROOM_A', () => {
    order.push('A');
  });

  const p2 = withRoomLock('ROOM_B', () => {
    order.push('B');
  });

  await Promise.all([p1, p2]);
  assert.equal(order.length, 2);
  assert.ok(order.includes('A'));
  assert.ok(order.includes('B'));
});

test('withRoomLock continues after error in locked function', async () => {
  const order = [];

  const p1 = withRoomLock('ROOM_ERR', () => {
    order.push('error-op');
    throw new Error('intentional');
  });

  const p2 = withRoomLock('ROOM_ERR', () => {
    order.push('after-error');
  });

  await Promise.allSettled([p1, p2]);
  assert.deepEqual(order, ['error-op', 'after-error']);
});
