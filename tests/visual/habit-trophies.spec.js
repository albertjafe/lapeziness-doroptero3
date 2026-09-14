import { test, expect } from '@playwright/test';

test('habit trophy case and detailed objective modal remain readable', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1024, height: 1194 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* isolated */' }));
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    localStorage.setItem('alberto_piano_v2', JSON.stringify({ obras: [{ id: 'piano', name: 'Bach', movimientos: [] }], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], habitChallenges: [
      { id: 'bathroom', title: 'No coger el móvil en el baño', description: 'El móvil se queda fuera para que ese momento sea una pausa real.', mode: 'avoid', startDate: '2026-08-02', durationDays: 21, logs: { '2026-08-02': { status: 'failed' } }, createdAt: '2026-08-02T12:00:00Z' },
      { id: 'bed', title: 'No móvil en la cama', description: 'Dejarlo cargando fuera del dormitorio.', mode: 'avoid', startDate: '2026-08-23', durationDays: 21, logs: {}, createdAt: '2026-08-23T12:00:00Z' },
    ] }));
  });
  await page.goto('/');
  await page.waitForFunction(() => window.HabitTrophies && window.setCronoCalendarObjectivesMode);
  await page.evaluate(() => showView('cronometro'));
  await page.getByRole('tab', { name: 'Vitrina', exact: true }).click();
  await expect(page.locator('.habit-trophy-card')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('habit-trophy-case.png'), fullPage: true });

  await page.evaluate(() => openHabitChallengeModal());
  await expect(page.locator('#habitDescriptionInput')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('habit-objective-modal.png'), fullPage: true });
});
