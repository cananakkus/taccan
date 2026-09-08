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
    const headerHeight = await host.locator('.bottom-bar').evaluate(el => el.getBoundingClientRect().height);
    await host.locator('#voice-join-btn').click();
    await expect(host.locator('#voice-join-btn')).toHaveClass(/in-voice/);
    expect(await host.locator('.bottom-bar').evaluate(el => el.getBoundingClientRect().height)).toBe(headerHeight);
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
    await expect(host.locator('#voice-mute-btn')).toBeVisible();
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
  test(`both spymasters see only the active turn clue at width ${width}`, async ({ browser }) => {
    const host = await openPlayer(browser);
    await host.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    const hostSession = await session(host);
    const guest = await openPlayer(browser, hostSession.code);
    await guest.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
    const room = ctx.rooms.get(hostSession.code);
    // Assign roles through the visible team controls.
    async function role(page, team) {
      await page.locator(`.team-${team} .btn-role`).first().click();
    }
    try {
      await host.locator('[data-panel="settings"]').click();
      await expect(host.locator('#sheet-settings')).toBeVisible();
      await host.locator('#sheet-settings .panel-close').click();
      await expect(host.locator('#sheet-settings')).not.toBeVisible();
      await expect(host.locator('#start-game-btn')).toBeVisible();
      await expect(host.locator('#sheet-feed')).toBeVisible();
      await expect(host.locator('#board')).toHaveCount(0);
      await host.locator('#chat-input').fill('Ready to play');
      await host.locator('#chat-form button').click();
      await expect(guest.locator('#feed-entries')).toContainText('Ready to play');
      expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await role(host, 'red');
      await role(guest, 'blue');
      const chatHeight = await host.locator('#sheet-feed').evaluate(el => el.getBoundingClientRect().height);
      for (let i = 0; i < 8; i++) {
        await host.locator('#chat-input').fill(`Message ${i}: ${'A longer message to exercise scrolling. '.repeat(3)}`);
        await host.locator('#chat-form button').click();
      }
      await expect(guest.locator('#feed-entries .feed-name.red').last()).toHaveText('Host:');
      expect(await host.locator('#sheet-feed').evaluate(el => el.getBoundingClientRect().height)).toBe(chatHeight);

      await host.locator('#start-game-btn').click();
      await expect.poll(() => room.game?.phase).toBe('hint');
      const boardHeights = await Promise.all([host, guest].map(page => page.locator('#board').evaluate(el => el.getBoundingClientRect().height)));

      for (const page of [host, guest]) {
        await expect(page.locator('.spymaster-roster')).toContainText(['Host', 'Guest']);
        await expect(page.locator('#sheet-teams .team-player-name')).toHaveCount(0);
      }
      const first = room.game.currentTeam === 'red' ? host : guest;
      const second = first === host ? guest : host;
      expect(await first.locator('.controls-strip').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      expect(await first.locator('#hint-section').evaluate(el => el.scrollHeight <= el.clientHeight + 1)).toBe(true);
      await first.locator('#hint-word-input').fill('galactic');
      await first.locator('#hint-form button[type="submit"]').click();
      await expect(second.locator('#hint-display')).toBeVisible();
      await expect(second.locator('#hint-display')).toContainText('GALACTIC');
      await expect(second.locator('#hint-display')).toContainText('guesses left');
      expect(await second.locator('.clue-word').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
      expect(await second.locator('.card-front .card-word').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);

      const operative = io(origin, { transports: ['websocket'], reconnection: false });
      clients.push(operative);
      await new Promise(resolve => operative.on('connect', resolve));
      await emit(operative, 'room:join', { code: room.code, name: 'Operative' });
      await emit(operative, 'team:set', { team: room.game.currentTeam });
      await emit(operative, 'turn:end', {});
      await expect(second.locator('#hint-word-input')).toBeVisible();
      await expect(second.locator('#hint-display')).not.toContainText('GALACTIC');
      await expect(second.locator('#feed-entries')).toContainText('GALACTIC');
      await second.locator('#hint-word-input').fill('oceanic');
      await second.locator('#hint-form button[type="submit"]').click();
      for (const page of [host, guest]) {
        await expect(page.locator('#hint-display')).not.toContainText('GALACTIC');
        await expect(page.locator('#hint-display')).toContainText('OCEANIC');
        expect(Math.abs(await page.locator('#board').evaluate(el => el.getBoundingClientRect().height) - boardHeights[page === host ? 0 : 1])).toBeLessThanOrEqual(1);

        await page.evaluate(() => window.scrollTo(0, 0));
        await expect(page.locator('#board')).toBeInViewport({ ratio: 1 });
        if (width === 1280) {
          expect(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight)).toBe(true);
          await expect(page.locator('#chat-input')).toBeInViewport({ ratio: 1 });
        }

        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.locator('#chat-input').scrollIntoViewIfNeeded();
        await expect(page.locator('#voice-join-btn')).toBeInViewport();
      }
      // Team changes must work during an active guessing turn without resetting it.
      const switchingSession = await session(second);
      const otherTeam = room.game.currentTeam === 'red' ? 'blue' : 'red';
      const beforeSwitch = JSON.stringify(room.game);
      await expect(second.locator('#manage-roles-btn')).toHaveAccessibleName('Change team');
      await second.locator('#manage-roles-btn').click();
      await expect(second.locator(`.team-${otherTeam} .team-head h3`)).toContainText(otherTeam === 'red' ? 'Red' : 'Blue');
      await second.locator(`.team-${otherTeam} .btn-role`).last().click();
      await expect.poll(() => room.players.get(switchingSession.sessionId).team).toBe(otherTeam);
      await expect.poll(() => room.players.get(switchingSession.sessionId).role).toBe('operative');
      await expect(second.locator(`.team-${otherTeam} .team-player-name`).filter({ hasText: second === host ? 'Host' : 'Guest' })).toHaveText(second === host ? 'Host' : 'Guest');
      expect(JSON.stringify(room.game)).toBe(beforeSwitch);
      await second.locator('#manage-roles-btn').click();
      await second.locator(`.team-${room.game.currentTeam} .btn-role`).last().click();
      await expect(second.locator('#manage-roles-btn')).toHaveAttribute('aria-expanded', 'false');
      await second.evaluate(() => window.scrollTo(0, 0));
      await expect(second.locator('#submit-guess-btn')).toBeInViewport({ ratio: 1 });
      await expect(second.locator('#guess-section')).not.toContainText('Click a card to mark');
      const team = room.game.currentTeam;
      const remaining = room.game.remaining[team];
      const card = room.game.board.find(card => card.color === team && !card.revealed);
      const tile = second.locator('#board > button').nth(card.index);
      await tile.click();
      await second.locator('#submit-guess-btn').click();
      await expect(tile).toHaveClass(/revealed/);
      await expect(second.locator('.feed-guess').last()).toHaveClass(new RegExp(team));
      await expect(tile.locator('.card-word')).toHaveCount(1);
      await expect(tile.locator('.card-inner')).toHaveCSS('transform', 'none');
      await expect(second.locator(`.status-score.${team}`)).toHaveText(`${remaining - 1} words left`);


    } finally {
      await host.close();
      await guest.close();
    }
  });
}

test('small phone keeps Turkish labels, lobby actions, and voice controls accessible', async ({ browser }) => {
  const page = await openPlayer(browser);
  try {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.locator('[data-panel="settings"]').click();
    await page.locator('#sheet-settings .language-switch button').last().click();
    await page.locator('#sheet-settings .panel-close').click();
    expect(await page.locator('.bottom-bar').evaluate(el => el.getBoundingClientRect().height)).toBeLessThanOrEqual(90);
    await expect(page.locator('#start-game-btn')).toBeVisible();
    await expect(page.locator('[data-panel="settings"] .bar-tab-label')).toBeVisible();
    await page.locator('#voice-join-btn').click();
    await expect(page.locator('#voice-mute-btn')).toBeVisible();
    await page.locator('#voice-mute-btn').click();
    await expect(page.locator('#voice-mute-btn')).toHaveClass(/muted/);
    await page.locator('#chat-input').scrollIntoViewIfNeeded();
    await expect(page.locator('#voice-mute-btn')).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    await page.close();
  }
});

test('crowded and uneven teams keep headings, actions and spectators accessible', async ({ browser }) => {
  const host = await openPlayer(browser);
  const { code } = await session(host);
  const crowd = [];
  try {
    for (let i = 0; i < 16; i++) {
      const client = io(origin, { transports: ['websocket'], reconnection: false });
      crowd.push(client); clients.push(client);
      await new Promise(resolve => client.on('connect', resolve));
      await emit(client, 'room:join', { code, name: `Alexandria Longname ${i}` });
      if (i < 14) {
        await emit(client, 'team:set', { team: i < 10 ? 'red' : 'blue' });
        await emit(client, 'role:set', { role: i === 0 || i === 10 ? 'spymaster' : 'operative' });
      }
    }
    await expect(host.locator('.spectator-roster')).toContainText('Watching · 3');
    for (const width of [1280, 390]) {
      await host.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
      await host.locator('#start-game-btn').scrollIntoViewIfNeeded();
      await expect(host.locator('#start-game-btn')).toBeInViewport({ ratio: 1 });
      const fits = await host.locator('#start-game-btn').evaluate(el => {
        const action = el.getBoundingClientRect();
        const panel = document.querySelector('#sheet-teams').getBoundingClientRect();
        return action.bottom <= panel.bottom && action.top >= panel.top;
      });
      expect(fits).toBe(true);
      expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await host.locator('#red-team-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
      await expect(host.locator('#red-team-list li').last()).toBeInViewport();
      await host.locator('#red-team-list li').last().focus();
      await expect(host.locator('#red-team-list li').last().locator('.team-player-name')).toHaveCSS('white-space', 'normal');
    }
    await host.setViewportSize({ width: 1280, height: 720 });
    await host.locator('#start-game-btn').click();
    await expect(host.locator('#manage-roles-btn')).toBeInViewport({ ratio: 1 });
    await expect(host.locator('#chat-input')).toBeInViewport({ ratio: 1 });
    await expect(host.locator('.team-red .team-head')).toContainText('9 operatives');
    await expect(host.locator('.team-blue .team-head')).toContainText('3 operatives');
    await host.locator('[data-panel="settings"]').click();
    await host.locator('#sheet-settings .language-switch button').last().click();
    await host.locator('#sheet-settings .panel-close').click();
    for (const width of [1280, 390, 320]) {
      await host.setViewportSize({ width, height: width === 1280 ? 720 : 844 });
      await host.evaluate(() => window.scrollTo(0, 0));
      await expect(host.locator('#manage-roles-btn')).toBeInViewport({ ratio: 1 });
      await expect(host.locator('[data-panel="settings"]')).toBeInViewport({ ratio: 1 });
      await expect(host.locator('#leave-room-btn')).toBeInViewport({ ratio: 1 });
      expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await expect(host.locator('.words-remaining').first()).toContainText('kelime kaldı');
      const size = await host.locator('.words-remaining').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize));
      expect(size).toBeGreaterThanOrEqual(18);
      expect(await host.locator('.words-remaining').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth))).toBe(true);
    }
    const compactHeaderHeight = await host.locator('.bottom-bar').evaluate(el => el.getBoundingClientRect().height);
    await host.locator('#voice-join-btn').click();
    await expect(host.locator('#voice-join-btn')).toHaveClass(/in-voice/);
    expect(await host.locator('.bottom-bar').evaluate(el => el.getBoundingClientRect().height)).toBe(compactHeaderHeight);
    await expect(host.locator('#voice-controls-btn')).toBeInViewport({ ratio: 1 });
    expect(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally {
    for (const client of crowd) { if (client.connected) await emit(client, 'room:leave', {}); client.disconnect(); }
    await host.close();
  }
});

test('revealed words use their card colours and finished turns clear the summary', async ({ browser }) => {
  const page = await openPlayer(browser);
  const { code } = await session(page);
  const room = ctx.rooms.get(code);
  const peers = [];
  try {
    for (const [name, team, role] of [['Clue giver', 'red', 'spymaster'], ['Guesser', 'blue', 'operative']]) {
      const peer = io(origin, { transports: ['websocket'], reconnection: false });
      peers.push(peer); clients.push(peer);
      await new Promise(resolve => peer.on('connect', resolve));
      await emit(peer, 'room:join', { code, name });
      await emit(peer, 'team:set', { team });
      await emit(peer, 'role:set', { role });
    }
    await page.locator('#start-game-btn').click();
    await expect.poll(() => room.game?.phase).toBe('hint');
    for (const color of ['red', 'blue', 'neutral', 'assassin']) {
      if (room.game.phase === 'guess') await emit(peers[1], 'turn:end', {});
      for (const peer of peers) await emit(peer, 'team:set', { team: room.game.currentTeam });
      await emit(peers[0], 'turn:hint_submit', { word: 'testclueabcd', count: 3 });
      await expect(page.locator('#hint-display')).toContainText('TESTCLUEABCD');
      const card = room.game.board.find(card => card.color === color && !card.revealed);
      await emit(peers[1], 'turn:guess', { index: card.index });
      const entry = page.locator('.feed-guess').last();
      await expect(entry).toHaveClass(new RegExp(`\\b${color}\\b`));
      if (color === 'red' || color === 'blue') {
        const expected = await page.locator(`.clue-slot[data-team="${color}"]`).evaluate(el => getComputedStyle(el).color);
        await expect(entry.locator('.feed-text')).toHaveCSS('color', expected);
      }
      if (room.game.phase !== 'guess') await expect(page.locator('#hint-display')).not.toContainText('TESTCLUEABCD');
    }
    await expect.poll(() => room.game.phase).toBe('finished');
    await expect(page.locator('#feed-entries')).toContainText('TESTCLUEABCD');
  } finally {
    for (const peer of peers) peer.disconnect();
    await page.close();
  }
});
