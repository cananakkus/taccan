const test = require('node:test'), assert = require('node:assert/strict');
const { io } = require('socket.io-client');
const { createApp } = require('../backend/server');

test('the chat history is sent once per binding, not with every state', async () => {
  const app = createApp({ restoreState: false, corsOrigin: '*' });
  await new Promise((r) => app.httpServer.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.httpServer.address().port;
  const connect = async () => { const s = io(base, { transports: ['websocket'], forceNew: true, reconnection: false }); s.states = []; s.on('state:full', (st) => s.states.push(st)); await new Promise((r) => s.once('connect', r)); return s; };
  const ack = (s, e, p) => new Promise((r) => s.timeout(3000).emit(e, p, (err, res) => r(err ? { ok: false } : res)));
  const a = await connect(), b = await connect();
  try {
    const { roomCode } = await ack(a, 'room:create', { name: 'A' });
    for (let i = 0; i < 5; i += 1) await ack(a, 'chat:send', { text: `message ${i} `.repeat(10) });
    await ack(b, 'room:join', { code: roomCode, name: 'B' });
    const first = b.states.at(-1);
    assert.equal(first.room.chatMessages.length, 5, 'a new member gets the history');
    await ack(a, 'role:set', { role: 'spymaster', team: 'red' });
    await new Promise((r) => setTimeout(r, 50));
    const later = b.states.at(-1);
    assert.equal(later.room.chatMessages, undefined, 'later states leave the history out');
    assert.ok(JSON.stringify(later).length < JSON.stringify(first).length);
    // A rejoin (new binding) gets the history again.
    const c = await connect();
    const { sessionId, reconnectToken } = first.me;
    assert.equal((await ack(c, 'room:rejoin', { code: roomCode, sessionId, reconnectToken })).ok, true);
    assert.equal(c.states.at(-1).room.chatMessages.length, 5);
    c.disconnect();
  } finally {
    a.disconnect(); b.disconnect();
    await new Promise((r) => app.io.close(r)); clearInterval(app.cleanupInterval);
  }
});
