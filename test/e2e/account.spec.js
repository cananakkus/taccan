const { test, expect } = require('@playwright/test');
const { createHmac } = require('node:crypto');
const { createApp } = require('../../backend/server');

const accountSecret = 'browser-test-account-key';
let ctx, origin;
function proof(exp) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify({ iss: 'wleeaf-play', aud: 'taccan', sub: 'browser-account', name: 'Wleeaf Player', exp })).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', accountSecret).update(`${head}.${body}`).digest('base64url')}`;
}
test.beforeAll(async () => {
  ctx = createApp({ corsOrigin: '*', restoreState: false, accountSecret, voiceEnv: { VOICE_CREDENTIAL_TTL_SECONDS: '120' } });
  await new Promise(resolve => ctx.httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${ctx.httpServer.address().port}`;
});
test.afterAll(async () => {
  clearInterval(ctx.cleanupInterval);
  await new Promise(resolve => ctx.io.close(resolve));
});

test('Wleeaf account renews without interrupting room membership or two-way voice', async ({ browser }) => {
  test.setTimeout(90_000);
  const owner = await browser.newPage();
  const guest = await browser.newPage();
  const errors = [];
  for (const page of [owner, guest]) {
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.testConnections = [];
      window.testIceRestarts = 0;
      const Original = window.RTCPeerConnection;
      window.RTCPeerConnection = class extends Original {
        constructor(config) { super(config); window.testConnections.push(this); }
        restartIce() { window.testIceRestarts++; return super.restartIce(); }
      };
    });
  }
  try {
    const initialExpiry = Math.floor(Date.now() / 1000) + 12;
    await owner.addInitScript(({ initial, renewed }) => {
      window.testAccountExchanges = 0;
      window.Wleeaf = {
        me: async () => ({ user: { name: 'Wleeaf Player' } }),
        session: async game => {
          if (game !== 'taccan') throw new Error('Wrong account audience');
          return { token: window.testAccountExchanges++ === 0 ? initial : renewed };
        },
        login: () => {}, logout: async () => {},
      };
    }, { initial: proof(initialExpiry), renewed: proof(Math.floor(Date.now() / 1000) + 300) });
    await owner.goto(`${origin}/murmur/`);
    await expect(owner.locator('#join-panel .account-controls')).toContainText('Wleeaf Player');
    await expect(owner.locator('#join-panel input').first()).toBeDisabled();
    await owner.locator('#room-action-btn').click();
    await expect(owner.locator('#room-panel')).toBeVisible();
    const saved = await owner.evaluate(() => JSON.parse(localStorage.getItem('taccan.session.v1')));
    const player = ctx.rooms.get(saved.code).players.get(saved.sessionId);
    const socketId = player.socketId;
    expect(player.accountId).toBe('browser-account');
    await guest.goto(`${origin}/murmur/room/${saved.code}`);
    await guest.locator('#join-panel input').first().fill('Guest');
    await guest.locator('#room-action-btn').click();
    await expect(guest.locator('#room-panel')).toBeVisible();
    await owner.locator('#voice-join-btn').click();
    await guest.locator('#voice-join-btn').click();
    for (const page of [owner, guest]) {
      await expect.poll(() => page.evaluate(async () => {
        let bytes = 0;
        for (const pc of window.testConnections) (await pc.getStats()).forEach(row => { if (row.type === 'inbound-rtp' && row.kind === 'audio') bytes += row.bytesReceived; });
        return bytes;
      })).toBeGreaterThan(0);
    }
    await expect.poll(() => owner.evaluate(() => window.testAccountExchanges)).toBeGreaterThan(1);
    await owner.waitForTimeout(Math.max(0, initialExpiry * 1000 - Date.now()) + 100);
    expect(player.socketId).toBe(socketId);
    expect(player.connected).toBe(true);
    expect(ctx.rooms.get(saved.code).voicePeers.has(saved.sessionId)).toBe(true);
    await expect(owner.locator('#voice-join-btn')).toHaveClass(/in-voice/);
    await expect.poll(() => guest.evaluate(() => window.testIceRestarts), { timeout: 65_000 }).toBeGreaterThan(0);
    await expect.poll(() => guest.evaluate(() => window.testConnections[0].connectionState)).toBe('connected');
    const audioBefore = await owner.evaluate(async () => {
      let bytes = 0;
      for (const pc of window.testConnections) (await pc.getStats()).forEach(row => { if (row.type === 'inbound-rtp' && row.kind === 'audio') bytes += row.bytesReceived; });
      return bytes;
    });
    await expect.poll(() => owner.evaluate(async () => {
      let bytes = 0;
      for (const pc of window.testConnections) (await pc.getStats()).forEach(row => { if (row.type === 'inbound-rtp' && row.kind === 'audio') bytes += row.bytesReceived; });
      return bytes;
    })).toBeGreaterThan(audioBefore);
    expect(errors).toEqual([]);
  } finally { await owner.close(); await guest.close(); }
});
