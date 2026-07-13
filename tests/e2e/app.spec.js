import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_1', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en smoke tests */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    localStorage.setItem('piano_auto_creds', JSON.stringify({ email: 'legacy@example.com', password: 'must-not-survive' }));
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
}

test('opens every main view without page exceptions', async ({ page }) => {
  const errors = [];
  const recordError = message => {
    const text = typeof message === 'string' ? message : message.message;
    if (text && !text.includes('ERR_NETWORK_ACCESS_DENIED')) errors.push(text);
  };
  page.on('pageerror', error => recordError(error.message));
  page.on('console', message => { if (message.type() === 'error') recordError(message.text()); });
  await prepare(page);

  for (const view of ['session', 'cronometro', 'obras', 'calendario', 'historial', 'ajustes']) {
    await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
    await expect(page.locator('#view-' + view)).toHaveClass(/active/);
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('piano_auto_creds'))).toBeNull();
});

test('keeps the app inside the viewport at the four target widths', async ({ browser }) => {
  test.setTimeout(90_000);
  for (const viewport of [{ width: 390, height: 844 }, { width: 834, height: 1194 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    for (const view of ['session', 'cronometro', 'obras', 'calendario', 'historial', 'ajustes']) {
      await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    }
    await context.close();
  }
});

test('keeps mobile navigation visible and marks empty daily states honestly', async ({ browser }) => {
  for (const viewport of [
    { width: 320, height: 844 },
    { width: 360, height: 844 },
    { width: 375, height: 844 },
    { width: 390, height: 844 },
    { width: 430, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    await page.evaluate(() => showView('session'));
    const state = await page.evaluate(() => ({
      navFits: document.querySelector('.nav.nav-bottom').scrollWidth <= document.querySelector('.nav.nav-bottom').clientWidth,
      documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      navButtons: [...document.querySelectorAll('.nav.nav-bottom .nav-btn')].map(btn => ({
        width: btn.getBoundingClientRect().width,
        height: btn.getBoundingClientRect().height,
        label: btn.getAttribute('aria-label'),
      })),
      wellbeingActive: document.querySelectorAll('#estadoFaces .estado-face.active').length,
      sleepActive: document.querySelectorAll('#suenoFaces .estado-face.active').length,
      wellbeingStatus: document.getElementById('estadoStatus')?.textContent,
      sleepStatus: document.getElementById('suenoStatus')?.textContent,
      summary: document.getElementById('sessionResumenCard')?.textContent,
    }));
    expect(state.navFits).toBe(true);
    expect(state.documentFits).toBe(true);
    expect(state.navButtons).toHaveLength(5);
    expect(state.navButtons.every(btn => btn.width > 0 && btn.height >= 44 && btn.label)).toBe(true);
    expect(state.wellbeingActive).toBe(0);
    expect(state.sleepActive).toBe(0);
    expect(state.wellbeingStatus).toContain('Sin registrar hoy');
    expect(state.sleepStatus).toContain('Sin registrar hoy');
    expect(state.summary).toContain('sin objetivo configurado');
    await context.close();
  }
});

test('refreshes statistics immediately after a local study save', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => showView('historial'));
  await expect(page.locator('#statsDashboard')).toContainText('0 min');
  await page.evaluate(() => {
    const end = Date.now();
    const start = end - 45 * 60 * 1000;
    recordSessionPlant('obra_1', null, new Date(start).toISOString(), new Date(end).toISOString(), 45, { source: 'e2e' });
    saveData();
  });
  await expect(page.locator('#statsDashboard')).toContainText('45 min');
});

test('shows pause as an accessible rest state', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => showView('cronometro'));
  await page.evaluate(() => {
    crono.state = 'paused';
    crono.mode = 'stopwatch';
    crono.isRest = false;
    crono.displayName = 'Bach · Preludio';
    crono.startTs = Date.now() - 25 * 60 * 1000;
    crono.pauseStartTs = Date.now();
    crono.pausedMs = 0;
    crono.targetMinutes = null;
    crono.targetDurationMs = null;
    crono.runId = 'e2e-pause-run';
    document.body.classList.add('crono-focus');
    cronoRender();
  });
  const overlay = page.locator('#cronoPauseOverlay');
  await expect(overlay).toHaveAttribute('aria-hidden', 'false');
  await expect(overlay.locator('#cronoPauseOverlayTitle')).toHaveText('Descanso');
  await expect(overlay.locator('#cronoPauseOverlaySession')).toContainText('Sesión pausada en');
  await expect(overlay.getByRole('button', { name: 'Reanudar' })).toBeVisible();
  await expect(page.locator('#cronoStageRun')).toHaveAttribute('inert', '');
});

test('can reload after going offline', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  const page = await context.newPage();
  await prepare(page);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(500);
  await expect(page.locator('body')).toBeVisible();
  await context.close();
});
