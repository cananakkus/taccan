const { test, expect } = require('@playwright/test');
const { createApp } = require('../../backend/server');
const { io } = require('socket.io-client');

let ctx;
let origin;
const clients = [];
test.beforeAll(async () => {
  ctx = createApp({ corsOrigin: '*' });
  await new Promise(resolve => ctx.httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${ctx.httpServer.address().port}`;
});
test.afterAll(async () => {
  for (const client of clients) client.disconnect();
  for (const timer of ctx.phaseTimers.values()) clearTimeout(timer);
  for (const timer of ctx.mvpTimers.values()) clearTimeout(timer);
  clearInterval(ctx.cleanupInterval);
  await new Promise(resolve => ctx.io.close(resolve));
});

async function openPlayer(browser, code) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    window.voiceConnections = [];
    const Original = window.RTCPeerConnection;
    window.RTCPeerConnection = class extends Original {
      constructor(config) { super(config); window.voiceConnections.push(this); }
    };
  });
  await page.goto(`${origin}/taccan/`);
  await page.locator('#join-panel input').first().fill(code ? 'Guest' : 'Host');
  if (code) {
    await page.locator('.code-field').fill(code);
    await page.locator('#join-btn').click();
  } else {
    await page.locator('#create-btn').click();
  }
  await expect(page.locator('#room-panel')).toBeVisible();
  return page;
}

async function session(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('taccan.session.v1')));
}

async function receivedAudio(page) {
  return page.evaluate(async () => {
    let bytes = 0;
    for (const pc of window.voiceConnections) {
      const stats = await pc.getStats();
      stats.forEach(row => {
        if (row.type === 'inbound-rtp' && row.kind === 'audio') bytes += row.bytesReceived;
      });
    }
    return bytes;
  });
}

test('voice sends audio both ways, respects mute, and can rejoin after disconnect', async ({ browser }) => {
  const host = await openPlayer(browser);
  await host.setViewportSize({ width: 390, height: 844 });
  const hostSession = await session(host);
  const guest = await openPlayer(browser, hostSession.code);
  const errors = [];
  for (const page of [host, guest]) page.on('pageerror', error => errors.push(error.message));
  try {
    await host.locator('#voice-join-btn').click();
    await expect(host.locator('#voice-join-btn')).toHaveClass(/in-voice/);
    await guest.locator('#voice-join-btn').click();
    await expect.poll(() => receivedAudio(host), { timeout: 15000 }).toBeGreaterThan(0);
    await expect.poll(() => receivedAudio(guest), { timeout: 15000 }).toBeGreaterThan(0);
    for (const page of [host, guest]) {
      await expect.poll(() => page.evaluate(async () => {
        let energy = 0;
        for (const pc of window.voiceConnections) {
          const stats = await pc.getStats();
          stats.forEach(row => { if (row.type === 'inbound-rtp') energy += row.totalAudioEnergy || 0; });
        }
        return energy;
      }), { timeout: 15000 }).toBeGreaterThan(0);
      await expect.poll(() => page.locator('#voice-audio-container audio').evaluateAll(elements => elements.length > 0 && elements.every(audio => !audio.paused))).toBe(true);
    }
    await host.locator('#voice-controls-btn').click();
    await host.locator('#voice-mute-btn').click();
    await expect.poll(() => host.evaluate(() => {
      const connected = window.voiceConnections.filter(pc => pc.connectionState === 'connected');
      return connected.length > 0 && connected.every(pc => pc.getSenders().every(sender => !sender.track || !sender.track.enabled));
    })).toBe(true);
    const player = ctx.rooms.get(hostSession.code).players.get(hostSession.sessionId);
    ctx.io.sockets.sockets.get(player.socketId).conn.close();
    await expect(host.locator('#voice-join-btn')).not.toHaveClass(/in-voice/);
    await expect.poll(() => player.connected).toBe(true);
    await host.locator('#voice-join-btn').click();
    await expect.poll(() => host.evaluate(() => window.voiceConnections.filter(pc => pc.connectionState === 'connected').length), { timeout: 15000 }).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await host.close();
    await guest.close();
  }
});

async function emit(client, event, payload) {
  const response = await client.timeout(5000).emitWithAck(event, payload);
  expect(response.ok, response.error).toBe(true);
  return response;
}

for (const width of [390, 1280]) {
  test(`both spymasters see clues across turns at width ${width}`, async ({ browser }) => {
    const host = await openPlayer(browser);
    await host.setViewportSize({ width, height: 844 });
    const hostSession = await session(host);
    const guest = await openPlayer(browser, hostSession.code);
    await guest.setViewportSize({ width, height: 844 });
    const room = ctx.rooms.get(hostSession.code);
    // Assign roles through the visible team controls.
    async function role(page, team) {
      await page.locator('[data-panel="teams"]').click();
      await page.locator(`.team-${team} .btn-role`).first().click();
      await page.locator('#sheet-backdrop').click({ position: { x: 5, y: 5 } });
    }
    try {
      if (width === 390) {
        await expect(host.locator('[data-panel="feed"]')).toBeVisible();
        await host.locator('[data-panel="feed"]').click();
        await expect(host.locator('#sheet-feed')).toBeVisible();
        await host.locator('#sheet-backdrop').click({ position: { x: 5, y: 5 } });
      }
      await role(host, 'red');
      await role(guest, 'blue');
      await host.locator('[data-panel="teams"]').click();
      await host.locator('#start-game-btn').click();
      await host.locator('#sheet-backdrop').click({ position: { x: 5, y: 5 } });
      await expect.poll(() => room.game?.phase).toBe('hint');
      const first = room.game.currentTeam === 'red' ? host : guest;
      const second = first === host ? guest : host;
      await first.locator('#hint-word-input').fill('galactic');
      await first.locator('#hint-form button[type="submit"]').click();
      await expect(second.locator('#hint-display')).toBeVisible();
      await expect(second.locator('#hint-display')).toContainText('GALACTIC');
      const operative = io(origin, { transports: ['websocket'], reconnection: false });
      clients.push(operative);
      await new Promise(resolve => operative.on('connect', resolve));
      await emit(operative, 'room:join', { code: room.code, name: 'Operative' });
      await emit(operative, 'team:set', { team: room.game.currentTeam });
      await emit(operative, 'turn:end', {});
      await expect(second.locator('#hint-word-input')).toBeVisible();
      await expect(second.locator('#hint-display')).toContainText('GALACTIC');
      await second.locator('#hint-word-input').fill('oceanic');
      await second.locator('#hint-form button[type="submit"]').click();
      for (const page of [host, guest]) {
        await expect(page.locator('#hint-display')).toContainText('GALACTIC');
        await expect(page.locator('#hint-display')).toContainText('OCEANIC');
      }
    } finally {
      await host.close();
      await guest.close();
    }
  });
}
