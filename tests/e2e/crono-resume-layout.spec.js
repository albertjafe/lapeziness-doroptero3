import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_resume', name: 'Obra de prueba', composer: 'Compositor', tipo: 'obra', movimientos: [], sol: 70, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en tests */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_resume';
    cronoUpdateStartBtn();
  });
  await page.waitForTimeout(120);
}

test('repairs a stale landscape-sized timer after resuming in iPad portrait', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await prepare(page);

  await page.evaluate(() => {
    const view = document.getElementById('view-cronometro');
    // Reproduce el estado de la captura: un cálculo antiguo de landscape queda
    // pegado después de que iPadOS ya haya vuelto a portrait.
    view.style.setProperty('--crono-interface-ring-size', '370px');
    view.dataset.resumeViewport = '1024x768';
    window.dispatchEvent(new Event('pageshow'));
  });
  await page.waitForTimeout(850);

  const geometry = await page.evaluate(() => {
    const view = document.getElementById('view-cronometro');
    const ring = document.querySelector('.crono-idle-display-wrap .crono-run-progress-svg');
    const start = document.getElementById('cronoStartBtn');
    const card = document.querySelector('.crono-idle-main');
    const drawer = document.getElementById('cronoIdleDrawer');
    const sr = start.getBoundingClientRect();
    const cr = card.getBoundingClientRect();
    const dr = drawer.getBoundingClientRect();
    const rr = ring.getBoundingClientRect();
    return {
      ringCss: parseFloat(getComputedStyle(view).getPropertyValue('--crono-interface-ring-size')),
      ringWidth: rr.width,
      startDisplay: getComputedStyle(start).display,
      startVisibility: getComputedStyle(start).visibility,
      startBottom: sr.bottom,
      cardBottom: cr.bottom,
      drawerTop: dr.top,
      viewportStamp: view.dataset.resumeViewport,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });

  expect(geometry.ringCss).toBeLessThanOrEqual(225.5);
  expect(geometry.ringWidth).toBeLessThanOrEqual(226);
  expect(geometry.startDisplay).not.toBe('none');
  expect(geometry.startVisibility).not.toBe('hidden');
  expect(geometry.startBottom).toBeLessThanOrEqual(geometry.cardBottom + 1);
  expect(geometry.startBottom).toBeLessThanOrEqual(geometry.drawerTop - 2);
  expect(geometry.viewportStamp).toBe('1024x1366');
  expect(geometry.documentFits).toBe(true);
});

test('revalidates the timer when the PWA becomes visible again', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await prepare(page);

  const before = await page.evaluate(() => {
    const view = document.getElementById('view-cronometro');
    view.style.setProperty('--crono-interface-ring-size', '370px');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    return view.style.getPropertyValue('--crono-interface-ring-size');
  });
  expect(before).toBeTruthy();
  await page.waitForTimeout(700);

  const after = await page.evaluate(() => {
    const view = document.getElementById('view-cronometro');
    return {
      inlineRing: parseFloat(view.style.getPropertyValue('--crono-interface-ring-size')),
      computedRing: parseFloat(getComputedStyle(view).getPropertyValue('--crono-interface-ring-size')),
      stamp: view.dataset.resumeViewport,
    };
  });
  expect(after.inlineRing).toBeLessThanOrEqual(225.5);
  expect(after.computedRing).toBeLessThanOrEqual(225.5);
  expect(after.stamp).toBe('1024x1366');
});
