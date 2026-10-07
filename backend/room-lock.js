const locks = new Map();

function withRoomLock(roomCode, fn) {
  const prev = locks.get(roomCode) || Promise.resolve();
  const next = prev.then(fn, fn);
  locks.set(roomCode, next);
  const release = () => {
    if (locks.get(roomCode) === next) locks.delete(roomCode);
  };
  next.then(release, release);
  return next;
}

module.exports = { withRoomLock };
