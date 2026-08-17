const { test, expect } = require('@playwright/test');

const fixture = {
  obras: [
    { id: 'bach', name: 'Partita n.º 2', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], paseHistory: [], solHistory: [] },
    { id: 'ligeti', name: 'Étude Désordre', composer: 'G. Ligeti', tipo: 'obra', movimientos: [], paseHistory: [], solHistory: [] },
  ],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], estadoEventos: [], impulsoEventos: [],
  deporteEventos: [], suenoEventos: [], triggerEventos: [], tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en visual tests */',
  }));
  await page.addInitScript(data => localStorage.setItem('alberto_piano_v2', JSON.stringify(data)), fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
}

test('keeps the liquid pass meter clear on iPhone and iPad', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await prepare(page);
  await page.evaluate(() => openCronoPaseRapido());
  const choices = page.locator('#cronoPaseSelectionList .crono-pase-picker-item');
  await choices.nth(0).click();
  await choices.nth(1).click();
  await page.locator('#cronoPaseContinueBtn').click();
  const meters = page.locator('#cronoPaseItems .pase-liquid-input');
  await expect(meters).toHaveCount(2);
  await meters.nth(0).fill('28');
  await meters.nth(1).fill('91');
  await page.waitForTimeout(180);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pases-liquidos-iphone.png'), fullPage: true });

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.evaluate(() => {
    closeModal('modalCronoPaseRapido');
    registerPase('bach');
  });
  await page.locator('#paseQPercent').fill('86');
  await expect(page.locator('#paseQMeter')).toHaveCSS('--pase-fill', '86%');
  await page.waitForTimeout(180);
  const fillRatio = await page.locator('#paseQMeter').evaluate(meter => {
    const reservoir = meter.querySelector('.pase-liquid-reservoir').getBoundingClientRect();
    const fill = meter.querySelector('.pase-liquid-fill').getBoundingClientRect();
    return fill.width / reservoir.width;
  });
  expect(fillRatio).toBeGreaterThan(0.84);
  expect(fillRatio).toBeLessThan(0.88);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pase-liquido-ipad.png'), fullPage: true });
});
