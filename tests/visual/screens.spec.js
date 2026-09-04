import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_1', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], estadoEventos: [], impulsoEventos: [],
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
  for (const view of ['session', 'cronometro', 'obras', 'calendario', 'historial', 'profesor']) {
    await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot.byteLength).toBeGreaterThan(1000);
    await testInfo.attach(view + '.png', { body: screenshot, contentType: 'image/png' });
  }

  await page.evaluate(() => {
    const today = habitDayKey();
    const start = habitKeyAt(today, -8);
    db.habitChallenge = {
      id: 'visual-habit', title: 'Practicar escalas', mode: 'do', durationDays: 21,
      startDate: start,
      logs: {
        [start]: { status: 'done', at: new Date().toISOString() },
        [habitKeyAt(start, 2)]: { status: 'done', at: new Date().toISOString() },
        [habitKeyAt(start, 3)]: { status: 'done', at: new Date().toISOString() },
        [habitKeyAt(start, 5)]: { status: 'done', at: new Date().toISOString() },
        [habitKeyAt(start, 7)]: { status: 'done', at: new Date().toISOString() },
      },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    showView('calendario');
    switchCalTab('objetivos', document.getElementById('calTabObjetivos'));
  });
  for (const viewport of [
    { width: 390, height: 844, name: 'movil-vertical' },
    { width: 844, height: 390, name: 'movil-horizontal' },
    { width: 834, height: 1194, name: 'ipad-vertical' },
    { width: 1024, height: 768, name: 'ipad-horizontal' },
  ]) {
    await page.setViewportSize(viewport);
    const objectivesPath = testInfo.outputPath('objetivos-' + viewport.name + '.png');
    const objectivesScreenshot = await page.screenshot({ path: objectivesPath, fullPage: true });
    expect(objectivesScreenshot.byteLength).toBeGreaterThan(1000);
    await testInfo.attach('objetivos-' + viewport.name + '.png', { path: objectivesPath, contentType: 'image/png' });
  }
});
