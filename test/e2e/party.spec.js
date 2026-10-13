// Play party path in a real page: hidden standalone controls, bots playing,
// keys the hub forwards (untrusted events), and the play:voice duck level.
const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { join } = require('node:path');
const { createApp } = require('../../backend/server');

const secret = 'e2e-party-secret'.repeat(3);
let ctx, origin, dir;
test.beforeAll(async () => {
  mkdirSync('data', { recursive: true });
  dir = mkdtempSync(join(process.cwd(), 'data/e2e-party-'));
  ctx = createApp({ corsOrigin: '*', restoreState: false, partySecret: secret, partyFile: join(dir, 'party.sqlite'), botDelayScale: 0.15 });
  await new Promise((resolve) => ctx.httpServer.listen(Number(process.env.TEST_PORT_BASE) || 0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${ctx.httpServer.address().port}`;
});
test.afterAll(async () => {
  clearInterval(ctx.cleanupInterval);
  for (const timer of ctx.phaseTimers.values()) clearTimeout(timer);
  await new Promise((resolve) => ctx.io.close(resolve));
  ctx.party.close();
  rmSync(dir, { recursive: true, force: true });
});

async function api(path, body) {
  const response = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return response.json();
}

test('a party seat plays with bots, forwarded keys and the voice duck level', async ({ browser }) => {
  test.setTimeout(90_000);
  const human = { id: randomUUID(), name: 'Ayşe', color: '#2a9d8f' };
  const bot = (name, skill) => ({ id: randomUUID(), name, color: '#e76f51', bot: true, skill });
  // Seats alternate red/blue; seats 0 and 1 are spymasters. Ayşe is a red operative.
  const match = { id: randomUUID(), players: [bot('Rusty', 'hard'), bot('Pip', 'normal'), human, bot('Bolt', 'easy')] };
  await api('/_party/matches', match);
  const seat = await api(`/_party/matches/${match.id}/join`, { player: human.id });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/party-api/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/launch')) return route.fulfill({ json: { ...seat, name: human.name, color: human.color } });
    if (url.pathname.endsWith('/me')) return route.fulfill({ json: { csrf: 'token' } });
    return route.fulfill({ json: { ok: true } });
  });
  try {
    await page.goto(`${origin}/murmur/?party=p1&match=${match.id}`);
    await expect(page.locator('#board .card:not(.placeholder)').first()).toBeVisible();
    // Standalone-only controls stay hidden in a tournament.
    for (const selector of ['#leave-room-btn', '#voice-join-btn', '#start-game-btn', '.bot-add-select', '#rematch-btn', '.bot-remove']) {
      await expect(page.locator(selector)).toHaveCount(0);
    }
    await expect(page.locator('.party-identity input[aria-label="Your name"]')).toHaveValue('Ayşe');
    await expect(page.locator('.bot-tag')).not.toHaveCount(0);
    // The red bot spymaster gives a clue in the page; Ayşe can guess with forwarded keys.
    const room = ctx.rooms.get(seat.room);
    if (room.game.currentTeam === 'blue') {
      await expect.poll(() => room.game.currentTeam, { timeout: 30_000 }).toBe('red');
    }
    await expect(page.locator('#guess-section')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.clue-word.has-hint')).toBeVisible();
    const forward = (key) => page.evaluate((k) => {
      const target = document.activeElement || document.body;
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k === ' ' ? 'Space' : k.length === 1 ? `Key${k.toUpperCase()}` : k, bubbles: true, cancelable: true }));
    }, key);
    await page.evaluate(() => document.activeElement?.blur());
    await forward('ArrowRight');
    await expect(page.locator('#board .card:focus')).toHaveCount(1);
    const focusedIndex = await page.evaluate(() => [...document.querySelectorAll('#board .card')].indexOf(document.activeElement));
    await forward(' ');
    await expect(page.locator('#selected-guess')).toContainText(':');
    const revealedBefore = room.game.board.filter((card) => card.revealed).length;
    await forward('g');
    await expect.poll(() => room.game.board.filter((card) => card.revealed).length).toBe(revealedBefore + 1);
    expect(room.game.board[focusedIndex].revealed).toBe(true);
    // Escape closes a panel opened from the navbar.
    await page.locator('.bar-tab[data-panel="settings"]').click();
    await expect(page.locator('#sheet-backdrop.visible')).toHaveCount(1);
    await forward('Escape');
    await expect(page.locator('#sheet-backdrop.visible')).toHaveCount(0);
    // play:voice: the hub's level wins when it is a finite number.
    const duck = () => page.evaluate(() => window.__murmurDuck());
    const post = (data) => page.evaluate((d) => window.postMessage(d, location.origin), data);
    await post({ type: 'play:voice', active: true, talking: true, level: 0.15 });
    await expect.poll(duck).toBe(0.15);
    await post({ type: 'play:voice', active: true, talking: false, level: 0.4 });
    await expect.poll(duck).toBe(0.4);
    await post({ type: 'play:voice', active: true, talking: true });
    await expect.poll(duck).toBe(0.22);
    await post({ type: 'play:voice', active: false, talking: false, level: 'loud' });
    await expect.poll(duck).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
});
