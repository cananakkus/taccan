const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const dns = require('node:dns');
const https = require('node:https');
const createRoomLifecycle = require('../backend/room-lifecycle');

for (const all of [false, true]) {
  for (const address of ['8.8.8.8', '127.0.0.1']) {
    test(`word pack validates DNS with all=${all}, address=${address}`, async (t) => {
      const lookupResult = all ? [{ address, family: 4 }] : address;
      t.mock.method(dns, 'lookup', (_host, _opts, callback) => {
        process.nextTick(() => callback(null, lookupResult, all ? undefined : 4));
      });
      t.mock.method(https, 'get', (_url, options, callback) => {
        const req = new EventEmitter();
        options.lookup('example.test', { all }, (error, result) => {
          if (error) return req.emit('error', error);
          assert.equal(result, lookupResult);
          const res = new EventEmitter();
          res.statusCode = 200;
          callback(res);
          res.emit('data', JSON.stringify(Array.from({ length: 50 }, (_, i) => `Word${i}`)));
          res.emit('end');
        });
        return req;
      });
      const { fetchWordPack } = createRoomLifecycle({});
      if (address === '127.0.0.1') {
        await assert.rejects(fetchWordPack('https://example.test/words'), /private\/internal/);
      } else {
        assert.equal((await fetchWordPack('https://example.test/words')).length, 50);
      }
    });
  }
}

test('word pack stops downloading oversized responses', async (t) => {
  let requestDestroyed = false;
  let responseDestroyed = false;
  t.mock.method(https, 'get', (_url, _options, callback) => {
    const req = new EventEmitter();
    req.destroy = () => { requestDestroyed = true; };
    process.nextTick(() => {
      const res = new EventEmitter();
      res.statusCode = 200;
      res.destroy = () => { responseDestroyed = true; };
      callback(res);
      res.emit('data', Buffer.alloc(1024 * 1024 + 1));
    });
    return req;
  });
  await assert.rejects(createRoomLifecycle({}).fetchWordPack('https://example.test/words'), /1 MiB/);
  assert.ok(requestDestroyed);
  assert.ok(responseDestroyed);
});
