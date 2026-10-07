const { test, expect } = require('@playwright/test');
const { createApp } = require('../../backend/server');

let ctx, origin;
test.beforeAll(async () => {
  ctx = createApp({ corsOrigin: '*', restoreState: false, stateFile: `/tmp/murmur-preferences-${process.pid}.json` });
  await new Promise(resolve => ctx.httpServer.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${ctx.httpServer.address().port}`;
});
test.afterAll(async () => {
  clearInterval(ctx.cleanupInterval);
  await new Promise(resolve => ctx.io.close(resolve));
});

for (const [locale, language] of [['tr-TR', 'tr'], ['en-US', 'en'], ['de-DE', 'en']]) {
  test(`account and language controls follow ${locale} and preserve manual choices`, async ({ browser }) => {
    const context = await browser.newContext({ locale });
    const page = await context.newPage();
    await page.addInitScript(() => {
      window.Wleeaf = {
        me: async () => ({ user: null }), session: async () => null,
        login: async () => { throw new Error('Sign-in unavailable'); }, logout: async () => {},
      };
    });
    try {
      await page.goto(`${origin}/murmur/`);
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      const signIn = page.locator('.landing-account button');
      await expect(signIn).toHaveText(language === 'tr' ? 'wleeaf ile giriş yap' : 'Sign in with wleeaf');
      await expect(page.locator('.account-controls')).toHaveCount(1);
      for (const [label, width, height] of [['desktop', 1280, 720], ['phone', 320, 568], ['landscape', 844, 390]]) {
        await page.setViewportSize({ width, height });
        await expect(signIn).toBeInViewport({ ratio: 1 });
        await expect(page.locator('#room-action-btn')).toBeInViewport({ ratio: 1 });
        const layout = await page.evaluate(() => {
          const account = document.querySelector('.landing-account').getBoundingClientRect();
          const card = document.querySelector('.join-card').getBoundingClientRect();
          return { accountLeft: account.left, accountBottom: account.bottom, cardTop: card.top, overflow: document.documentElement.scrollWidth > innerWidth };
        });
        expect(layout.overflow).toBe(false);
        expect(layout.accountLeft).toBeGreaterThan(0);
        expect(layout.accountBottom).toBeLessThanOrEqual(layout.cardTop);
        if (language === 'tr') await page.screenshot({ path: `/tmp/murmur-language-${label}.png`, fullPage: true });
      }
      await signIn.click();
      await expect(page.locator('.landing-account [role="status"]')).toHaveText(language === 'tr' ? 'Giriş yapılamadı. Lütfen tekrar dene.' : 'Could not sign in. Please try again.');
      const chosen = language === 'tr' ? 'en' : 'tr';
      await page.locator('#join-panel .language-flag').nth(chosen === 'en' ? 0 : 1).click();
      await expect(page.locator('html')).toHaveAttribute('lang', chosen);
      await expect(signIn).toHaveText(chosen === 'tr' ? 'wleeaf ile giriş yap' : 'Sign in with wleeaf');
      await page.reload();
      await expect(page.locator('html')).toHaveAttribute('lang', chosen);
      await page.locator('#room-action-btn').click();
      await expect(page.locator('#room-panel')).toBeVisible();
      await expect(page.locator('.landing-account .account-controls')).toHaveCount(0);
      await expect(page.locator('.account-controls')).toHaveCount(1);
      await page.locator('[data-panel="settings"]').click();
      await expect(page.locator('#sheet-settings .account-controls')).toBeVisible();
      await expect(page.locator('#sheet-settings .account-controls button')).toHaveText(chosen === 'tr' ? 'wleeaf ile giriş yap' : 'Sign in with wleeaf');
      await page.locator('#sheet-settings .language-flag').nth(language === 'en' ? 0 : 1).click();
      await expect(page.locator('html')).toHaveAttribute('lang', language);
      if (language === 'tr') await page.screenshot({ path: '/tmp/murmur-language-settings.png', fullPage: true });
    } finally {
      await context.close();
    }
  });
}
