import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_1', name: 'Concierto n.º 3', composer: 'Rachmaninov', tipo: 'obra', movimientos: [], sol: 62, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], cronoTasks: [], weeklyPlans: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en la prueba de escritorio */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.showView === 'function');
  await page.evaluate(() => {
    const splash = document.getElementById('splashScreen');
    if (splash) splash.style.display = 'none';
    showView('session');
  });
}

test('uses the approved compact Windows shell at desktop widths', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);

  const layout = await page.evaluate(() => {
    const rect = selector => {
      const box = document.querySelector(selector).getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, width: box.width, height: box.height };
    };
    return {
      windows: document.documentElement.classList.contains('platform-windows'),
      rail: rect('body > .nav-bottom'),
      headerFont: parseFloat(getComputedStyle(document.getElementById('headerTitle')).fontSize),
      plan: rect('.desktop-plan-heading'),
      side: rect('.desktop-today-side'),
      summaryColumns: getComputedStyle(document.getElementById('sessionResumenCard')).gridTemplateColumns.split(' ').filter(Boolean).length,
      professorVisible: document.querySelector('.nav-btn[data-view="profesor"]').getBoundingClientRect().height > 0,
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });

  expect(layout.windows).toBe(true);
  expect(layout.rail.width).toBeGreaterThanOrEqual(210);
  expect(layout.rail.height).toBeGreaterThanOrEqual(899);
  expect(layout.headerFont).toBeGreaterThanOrEqual(28);
  expect(layout.summaryColumns).toBe(5);
  expect(layout.side.left).toBeGreaterThan(layout.plan.right);
  expect(layout.professorVisible).toBe(true);
  expect(layout.fits).toBe(true);

  await page.setViewportSize({ width: 1024, height: 900 });
  const compact = await page.evaluate(() => ({
    railWidth: document.querySelector('body > .nav-bottom').getBoundingClientRect().width,
    sideVisible: document.querySelector('.desktop-today-side').getBoundingClientRect().height > 0,
    fits: document.documentElement.scrollWidth <= innerWidth + 1,
  }));
  expect(compact.railWidth).toBeGreaterThanOrEqual(180);
  expect(compact.sideVisible).toBe(true);
  expect(compact.fits).toBe(true);
});

test('keeps the Windows stopwatch spacious and exposes pause and finish separately', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await prepare(page);
  await page.evaluate(() => {
    showView('cronometro');
    cronoFillObraSelect();
    const select = document.getElementById('cronoObraSelect');
    select.value = Array.from(select.options).find(option => option.value).value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    cronoUpdateStartBtn();
  });

  const idle = await page.evaluate(() => {
    const main = document.querySelector('.crono-idle-main').getBoundingClientRect();
    const drawer = document.getElementById('cronoIdleDrawer').getBoundingClientRect();
    const ring = document.getElementById('cronoIdleDisplayWrap').getBoundingClientRect();
    return { mainRight: main.right, drawerLeft: drawer.left, ringWidth: ring.width };
  });
  expect(idle.drawerLeft).toBeGreaterThan(idle.mainRight);
  expect(idle.ringWidth).toBeGreaterThanOrEqual(210);

  await page.evaluate(() => {
    cronoStart();
    crono.startTs = Date.now() - 42 * 60 * 1000;
    cronoRender();
  });
  await expect(page.locator('#cronoControls .crono-session-main-btn')).toBeVisible();
  await expect(page.locator('#cronoControls .crono-session-finish-btn')).toBeVisible();
  await expect(page.locator('#cronoControls .crono-session-main-btn')).toHaveAttribute('aria-label', 'Pausar');

  const running = await page.evaluate(() => {
    const stage = document.getElementById('cronoStageRun').getBoundingClientRect();
    const drawer = document.getElementById('cronoRunDrawer').getBoundingClientRect();
    const pause = document.querySelector('#cronoControls .crono-session-main-btn').getBoundingClientRect();
    const finish = document.querySelector('#cronoControls .crono-session-finish-btn').getBoundingClientRect();
    return {
      drawerPastStage: drawer.left > stage.right,
      actionsShareRow: Math.abs(pause.top - finish.top) <= 2,
      fits: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });
  expect(running.drawerPastStage).toBe(true);
  expect(running.actionsShareRow).toBe(true);
  expect(running.fits).toBe(true);
});
