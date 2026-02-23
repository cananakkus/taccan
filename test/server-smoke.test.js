const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

function getEphemeralPort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Could not allocate ephemeral port.')));
        return;
      }

      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForHealth(url, attempts = 40, delayMs = 100) {
  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (_error) {
      // Retry until timeout.
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`Server did not become healthy at ${url}`);
}

test('server boots and responds on /api/health', async (t) => {
  let port;
  try {
    port = await getEphemeralPort();
  } catch (error) {
    if (error && error.code === 'EPERM') {
      t.skip('Sandbox does not permit binding local ports.');
      return;
    }
    throw error;
  }

  const cwd = path.join(__dirname, '..');
  const child = spawn('node', ['backend/server.js'], {
    cwd,
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  try {
    const payload = await waitForHealth(`http://127.0.0.1:${port}/api/health`);
    assert.equal(payload.ok, true);
    assert.equal(typeof payload.roomCount, 'number');
    assert.equal(typeof payload.connectedPlayers, 'number');
    assert.equal(typeof payload.metrics, 'object');
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
  }
});
