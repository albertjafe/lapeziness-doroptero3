import { test, expect } from '@playwright/test';

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en smoke tests */',
  }));
  await page.addInitScript(() => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify({
      obras: [], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
      estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
      tiempoDisponibleEventos: [], dailyJournalEntries: [], competitionPlanningSeedVersion: 1,
    }));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
}

test('removes Casa from navigation and redirects legacy Casa navigation to Hoy', async ({ page }) => {
  await prepare(page);

  await expect(page.locator('.nav-btn[data-view="casa"]')).toHaveCount(0);
  await expect(page.locator('#view-casa')).toHaveCount(0);

  await page.evaluate(() => showView('casa'));
  await expect(page.locator('#view-session')).toHaveClass(/active/);
  await expect(page.locator('.nav-btn[data-view="session"]')).toHaveClass(/active/);
});
