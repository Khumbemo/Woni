import { test, expect } from '@playwright/test';

/**
 * Layout checks for phone, tablet and laptop sizes:
 * no sideways scrolling, the right navigation style, and a full-screen
 * practice session (it used to be clipped inside the Practice view).
 */
const SIZES = [
  { name: 'phone', width: 390, height: 844, nav: 'bottom' },
  { name: 'phone landscape', width: 844, height: 390, nav: 'bottom' },
  { name: 'tablet', width: 820, height: 1180, nav: 'bottom' },
  { name: 'laptop', width: 1440, height: 900, nav: 'side' },
];
const VIEWS = ['dashboard', 'library', 'upload', 'practice', 'progress', 'settings'];

async function enterApp(page) {
  await page.goto('/');
  await page.waitForFunction(() => window.app?.state?.db, null, { timeout: 25000 });
  await page.evaluate(() => {
    localStorage.setItem('woni_guest_mode', 'true');
    localStorage.setItem('woni_setup_done', 'true');
    localStorage.setItem('woni_user_exams', JSON.stringify([{ id: 'csir_net', name: 'CSIR NET' }]));
  });
  await page.reload();
  await page.waitForFunction(() => window.app?.state?.db, null, { timeout: 25000 });
}

for (const size of SIZES) {
  test.describe(`${size.name} (${size.width}×${size.height})`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test('no view scrolls sideways', async ({ page }) => {
      await enterApp(page);
      for (const view of VIEWS) {
        await page.evaluate(v => window.app.showView(v), view);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
        expect(overflow, `${view} overflows by ${overflow}px`).toBeLessThanOrEqual(1);
      }
    });

    test(`navigation is a ${size.nav} bar and fully on screen`, async ({ page }) => {
      await enterApp(page);
      const nav = await page.locator('.bottom-nav').boundingBox();
      if (size.nav === 'side') {
        expect(nav.x).toBe(0);
        expect(nav.height).toBeGreaterThanOrEqual(size.height - 1);
        expect(nav.width).toBeLessThan(300);
      } else {
        expect(nav.width).toBeGreaterThanOrEqual(size.width - 1);
        expect(nav.y + nav.height).toBeLessThanOrEqual(size.height + 1);
      }
    });

    test('a practice session fills the screen above the navigation', async ({ page }) => {
      await enterApp(page);
      await page.evaluate(() => window.app.dbAdd('questions', {
        exam: 'csir_net', topic: 'Genetics', text: 'Which enzyme unwinds DNA?',
        options: ['Primase', 'DNA ligase', 'Helicase', 'Topoisomerase I'], answer: 'C', explanation: 'Helicase.',
      }));
      await page.evaluate(() => { window.app.showView('practice'); return window.app.startTopicTest('csir_net', [], 1); });
      const overlay = await page.locator('#active-session-overlay').boundingBox();
      expect(overlay.width).toBeGreaterThanOrEqual(size.width - 1);
      expect(overlay.height).toBeGreaterThanOrEqual(size.height - 1);
      // The overlay is on top of the navigation, and every option can be reached.
      const topIsOverlay = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('#active-session-overlay'),
        [size.width / 2, size.height - 5]);
      expect(topIsOverlay).toBe(true);
      await page.locator('.option-btn').nth(3).scrollIntoViewIfNeeded();
      await expect(page.locator('.option-btn').nth(3)).toBeInViewport();
    });
  });
}
