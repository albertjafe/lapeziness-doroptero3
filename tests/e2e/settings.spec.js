import { test, expect } from '@playwright/test';

// Ajustes (v456): listas agrupadas en móvil, iPad y escritorio.
const winUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36';
const targets = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  ipad: { viewport: { width: 834, height: 1194 }, hasTouch: true },
  desktop: { viewport: { width: 1366, height: 768 }, userAgent: winUA },
};

for (const [name, options] of Object.entries(targets)) {
  test(`ajustes organizados y sin desbordes · ${name}`, async ({ browser }) => {
    test.setTimeout(60_000);
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
    await page.addInitScript(() => localStorage.setItem('alberto_piano_v2', JSON.stringify({ competitionPlanningSeedVersion: 999, obras: [], eventos: [], sesiones: [], sessionPlants: [], forestPlants: [] })));
    await page.goto('/');
    await page.waitForFunction(() => document.getElementById('splashScreen')?.classList.contains('gone'), null, { timeout: 20_000 }).catch(() => {});
    await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (_) {} openSettings(); });

    const view = page.locator('#view-ajustes');
    await expect(view).toBeVisible();
    for (const id of ['stCuenta', 'stApariencia', 'stSonido', 'stAvisos', 'stEstudio', 'stDatos']) {
      await expect(view.locator('#' + id)).toBeAttached();
    }

    const layout = await page.evaluate(() => {
      const root = document.getElementById('view-ajustes');
      const overflowing = [...root.querySelectorAll('.st-row')].filter(row => {
        if (!row.offsetParent) return false;
        const box = row.getBoundingClientRect();
        return [...row.children].some(child => {
          if (!child.offsetParent) return false;
          const inner = child.getBoundingClientRect();
          return inner.right > box.right + 1 || inner.left < box.left - 1;
        });
      }).map(row => row.textContent.trim().slice(0, 40));
      return {
        fits: document.documentElement.scrollWidth <= window.innerWidth + 1,
        overflowing,
        index: getComputedStyle(root.querySelector('.st-index')).display,
        rawAuthError: /AuthSessionMissingError/.test(root.textContent),
      };
    });
    expect(layout.fits).toBe(true);
    expect(layout.overflowing).toEqual([]);
    expect(layout.rawAuthError).toBe(false);
    expect(layout.index === 'none').toBe(name === 'phone');

    // La barra de volumen pinta el relleno según el valor (antes, fijo al 70 %).
    await page.evaluate(() => setSoundVolume(30));
    await expect(page.locator('#soundVolumeSlider')).toHaveAttribute('style', /--fp:\s*30%/);
    await expect(page.locator('#soundVolumeLabel')).toHaveText('30%');

    const toggle = page.locator('#hapticsToggleBtn');
    const before = await toggle.getAttribute('aria-checked');
    await toggle.click();
    await expect(toggle).not.toHaveAttribute('aria-checked', before);
    const size = await toggle.boundingBox();
    expect(size.width).toBeGreaterThanOrEqual(44);

    if (name !== 'phone') {
      await view.locator('[data-st-jump="stDatos"]').click();
      await expect(view.locator('#stDatos')).toBeInViewport();
    }

    await view.locator('#stEstudio').getByRole('button', { name: /^Estadísticas/ }).click();
    await expect(page.locator('#view-ajustes')).toBeHidden();
    await context.close();
  });
}
