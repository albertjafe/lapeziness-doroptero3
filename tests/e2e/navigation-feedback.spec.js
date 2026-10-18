import { test, expect } from '@playwright/test';

const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1';
const windows = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36';
const fixture = { competitionPlanningSeedVersion: 999, obras: [{ id: 'w', name: 'Synthetic work', movimientos: [] }],
  eventos: [], sesiones: [], sessionPlants: [], forestPlants: [], registro: [] };

for (const [width, height, desktop] of [[390, 844, false], [834, 1194, false], [1194, 834, false], [1366, 900, true]]) {
  test.describe(`navigation feedback ${width}`, () => {
    test.use({ viewport: { width, height }, hasTouch: !desktop,
      userAgent: desktop ? windows : width < 700 ? ipad.replace('iPad; CPU OS', 'iPhone; CPU iPhone OS') : ipad });
    test('returning from Calendar to Today keeps the bar and its buttons at their normal height throughout the click', async ({ page }) => {
      await page.route('**/*', r => new URL(r.request().url()).hostname === '127.0.0.1' ? r.continue() : r.abort());
      await page.addInitScript(({ data, desktop, phone }) => {
        Object.defineProperty(navigator, 'platform', { get: () => desktop ? 'Win32' : phone ? 'iPhone' : 'MacIntel' });
        Object.defineProperty(navigator, 'maxTouchPoints', { get: () => desktop ? 0 : 5 });
        localStorage.setItem('alberto_mobile_design', 'v2');
        localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
      }, { data: fixture, desktop, phone: width < 700 });
      await page.goto('/');
      await expect(page.locator('#splashScreen')).toHaveClass(/gone/);
      await page.waitForFunction(() => window.MobileV2 && window.PianoRewards);
      await page.evaluate(() => { document.querySelectorAll('.modal-overlay.visible').forEach(x => closeModal(x.id)); showView('calendario'); });
      const normal = await page.locator('body > .nav-bottom').evaluate(nav => ({
        height: nav.offsetHeight, buttons: [...nav.querySelectorAll('.nav-btn')].map(button => button.offsetHeight),
      }));
      for (const view of ['session', 'obras', 'session']) {
        await page.evaluate(() => {
          window.__navFrames = [];
          window.__navDone = new Promise(resolve => {
            const start = performance.now(), nav = document.querySelector('body > .nav-bottom');
            const record = () => {
              window.__navFrames.push({ height: nav.offsetHeight, buttons: [...nav.querySelectorAll('.nav-btn')].map(button => button.offsetHeight) });
              if (performance.now() - start < 800) requestAnimationFrame(record); else resolve();
            };
            record();
          });
        });
        const button = page.locator(`body > .nav-bottom [data-view="${view}"]`);
        if (desktop) await button.click(); else await button.tap();
        const frames = await page.evaluate(async () => { await window.__navDone; return window.__navFrames; });
        expect(Math.max(...frames.map(f => Math.abs(f.height - normal.height)))).toBeLessThan(2);
        frames.forEach(f => f.buttons.forEach((height, i) => expect(Math.abs(height - normal.buttons[i])).toBeLessThan(2)));
        await expect(page.locator('body')).toHaveAttribute('data-view', view);
        await expect(button).toHaveAttribute('aria-current', 'page');
        await expect(page.locator('.view-swipe-nav,.view-swipe-page')).toHaveCount(0);
      }
    });
  });
}
