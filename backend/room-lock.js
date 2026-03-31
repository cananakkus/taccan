const locks = new Map();

function withRoomLock(roomCode, fn) {
  const prev = locks.get(roomCode) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(roomCode, next);
  next.then(() => {
    if (locks.get(roomCode) === next) locks.delete(roomCode);
  });
  return next;
}

module.exports = { withRoomLock };
