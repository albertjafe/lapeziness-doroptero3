import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_1', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], estadoEventos: [],
  deporteEventos: [], suenoEventos: [], triggerEventos: [], tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

test('captures stable responsive views', async ({ page }, testInfo) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en smoke tests */',
  }));
  await page.addInitScript(data => localStorage.setItem('alberto_piano_v2', JSON.stringify(data)), fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  for (const view of ['session', 'cronometro', 'obras', 'calendario', 'historial', 'ajustes']) {
    await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot.byteLength).toBeGreaterThan(1000);
    await testInfo.attach(view + '.png', { body: screenshot, contentType: 'image/png' });
  }
});
