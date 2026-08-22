import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_1', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page, options = {}) {
  if (!options.preservePlatform) {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36',
      });
      Object.defineProperty(navigator, 'userAgentData', {
        configurable: true,
        get: () => ({ platform: 'macOS' }),
      });
    });
  }
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en smoke tests */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    localStorage.setItem('piano_auto_creds', JSON.stringify({ email: 'legacy@example.com', password: 'must-not-survive' }));
  }, options.data || fixture);
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

  for (const view of ['pulse', 'session', 'cronometro', 'obras', 'calendario', 'historial', 'ajustes']) {
    await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
    if (view === 'historial') {
      await expect(page.locator('#view-session')).toHaveClass(/active/);
      await expect(page.locator('#sessionStatsSection')).toBeVisible();
    } else {
      await expect(page.locator('#view-' + view)).toHaveClass(/active/);
    }
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('piano_auto_creds'))).toBeNull();
});

test('shows cached Google events as a stable optional calendar layer', async ({ page }) => {
  const now = new Date();
  const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  await page.addInitScript(({ date, lastSync }) => {
    localStorage.setItem('alberto_google_calendar_v1', JSON.stringify({
      connected: true,
      layer: true,
      calendars: [{ id: 'primary', name: 'Personal', primary: true, color: '#4285f4' }],
      selectedIds: ['primary'],
      events: [{
        id: 'google-event', calendarId: 'primary', calendarName: 'Personal', color: '#4285f4',
        title: 'Ensayo con Marta', start: date, end: nextDate(date), allDay: true,
      }],
      lastSync,
    }));

    function nextDate(value) {
      const parts = value.split('-').map(Number);
      const next = new Date(parts[0], parts[1] - 1, parts[2] + 1, 12);
      return [next.getFullYear(), String(next.getMonth() + 1).padStart(2, '0'), String(next.getDate()).padStart(2, '0')].join('-');
    }
  }, { date, lastSync: new Date().toISOString() });
  await prepare(page);

  await page.evaluate(() => {
    showView('calendario');
    switchCalTab('mes', document.getElementById('calTabMes'));
  });
  const toggle = page.locator('#calendarGoogleToggle');
  await expect(toggle).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.mes-dot.google[title="Ensayo con Marta"]')).toHaveCount(1);
  const before = await page.locator('#mesGrid').evaluate(element => element.getBoundingClientRect().height);

  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.mes-dot.google')).toHaveCount(0);
  const after = await page.locator('#mesGrid').evaluate(element => element.getBoundingClientRect().height);
  expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
});

test('uses mouse navigation only on Windows and preserves the iPad navigation', async ({ browser }) => {
  const windows = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36',
  });
  const windowsPage = await windows.newPage();
  await prepare(windowsPage, { preservePlatform: true });

  await expect(windowsPage.locator('html')).toHaveClass(/platform-windows/);
  const rail = windowsPage.locator('body > .nav-bottom');
  const pulse = rail.locator('[data-view="pulse"]');
  await expect(pulse).toBeVisible();
  const railBox = await rail.boundingBox();
  expect(railBox.x).toBeLessThan(2);
  expect(railBox.width).toBeGreaterThanOrEqual(94);
  expect(railBox.height).toBeGreaterThanOrEqual(760);
  await pulse.click();
  await expect(windowsPage.locator('#view-pulse')).toHaveClass(/active/);
  await expect(windowsPage.locator('#headerTitle')).toContainText('Pulso');
  expect(await windowsPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
  await rail.locator('[data-view="cronometro"]').click();
  await expect(windowsPage.locator('#view-cronometro')).toHaveClass(/active/);
  await expect(rail).toBeVisible();
  await pulse.click();
  await expect(windowsPage.locator('#view-pulse')).toHaveClass(/active/);
  await windows.close();

  const ipad = await browser.newContext({
    viewport: { width: 1024, height: 1366 },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1',
    hasTouch: true,
  });
  const ipadPage = await ipad.newPage();
  await prepare(ipadPage, { preservePlatform: true });
  await expect(ipadPage.locator('html')).not.toHaveClass(/platform-windows/);
  await expect(ipadPage.locator('.windows-only-nav')).toBeHidden();
  const ipadNavBox = await ipadPage.locator('body > .nav-bottom').boundingBox();
  expect(ipadNavBox.y).toBeGreaterThan(1200);
  expect(ipadNavBox.width).toBeGreaterThan(1000);
  await ipad.close();
});

test('shows today study time prominently and includes the running stopwatch', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => showView('session'));
  const summary = page.locator('#sessionResumenCard');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('TIEMPO ESTUDIADO HOY');
  await expect(summary).toContainText('0 min');

  await page.evaluate(() => {
    const now = new Date();
    db.sessionPlants.push({
      id: 'today-summary-test',
      obraId: 'obra_1',
      startedAt: new Date(now.getTime() - 50 * 60000).toISOString(),
      endedAt: new Date(now.getTime() - 8 * 60000).toISOString(),
      mins: 42,
      source: 'app',
    });
    crono.state = 'running';
    crono.startTs = Date.now() - 5 * 60000;
    crono.pausedMs = 0;
    crono.targetMinutes = null;
    crono.targetDurationMs = null;
    renderSessionResumen();
  });
  await expect(summary).toContainText('47 min');
  await expect(summary).toContainText('en directo');
});

test('builds an editable weekly study plan without horizontal scrolling', async ({ page }) => {
  const eventDate = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const data = {
    ...fixture,
    obras: [
      { id: 'urgent', name: 'Ligeti · Estudio', tipo: 'obra', movimientos: [], sol: 45, solHistory: [] },
      { id: 'weak', name: 'Scarlatti · Sonata', tipo: 'obra', movimientos: [], sol: 25, solHistory: [] },
      { id: 'stable', name: 'Bach · Preludio', tipo: 'obra', movimientos: [], sol: 90, solHistory: [] },
    ],
    eventos: [{ id: 'competition', nombre: 'Concurso', tipo: 'concurso', fecha: eventDate, obras: ['urgent'] }],
    weeklyPlans: [],
  };
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page, { data });
  await page.evaluate(() => setSessionSectionMode('week'));

  await expect(page.locator('#sessionWeeklyPlanner')).toBeVisible();
  await expect(page.locator('.weekly-day-card')).toHaveCount(7);
  await expect(page.locator('.weekly-slot')).toHaveCount(14);
  await expect(page.locator('#weeklyPlannerGrid')).toContainText('Ligeti · Estudio');
  expect(await page.evaluate(() => getComputedStyle(document.getElementById('weeklyPlannerGrid')).gridTemplateColumns.split(' ').length)).toBe(7);

  await page.locator('.weekly-slot').first().click();
  await page.locator('#weeklySlotObraSelect').selectOption('stable');
  await page.locator('#weeklySlotLocked').check();
  await page.locator('#modalWeeklySlot .modal-btn.primary').click();
  const lockedBefore = await page.evaluate(() => {
    const plan = db.weeklyPlans.find(item => item.weekStart === _weeklyDateKey(_weeklyVisibleStart()));
    return plan.slots.find(item => item.date === _weeklyDateKey(_weeklyVisibleStart()) && item.position === 0);
  });
  expect(lockedBefore).toMatchObject({ obraId: 'stable', locked: true, reasonKind: 'manual' });

  await page.evaluate(() => regenerateWeeklyPlan());
  const lockedAfter = await page.evaluate(() => {
    const plan = db.weeklyPlans.find(item => item.weekStart === _weeklyDateKey(_weeklyVisibleStart()));
    return plan.slots.find(item => item.date === _weeklyDateKey(_weeklyVisibleStart()) && item.position === 0);
  });
  expect(lockedAfter).toMatchObject({ obraId: 'stable', locked: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const mobileLayout = await page.evaluate(() => {
    const grid = document.getElementById('weeklyPlannerGrid');
    const day = document.querySelector('.weekly-day-card');
    return {
      gridColumns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
      dayColumns: getComputedStyle(day).gridTemplateColumns.split(' ').length,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
      gridFits: grid.scrollWidth <= grid.clientWidth + 1,
    };
  });
  expect(mobileLayout).toEqual({ gridColumns: 1, dayColumns: 3, documentFits: true, gridFits: true });
});

test('keeps events readable, adds competition rounds and compacts completed history', async ({ page }) => {
  await prepare(page);
  const start = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const final = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10);

  await page.evaluate(() => {
    showView('calendario');
    switchCalTab('eventos', document.getElementById('calTabEventos'));
    openAddEvento();
  });
  await expect(page.locator('#eventoRondasField')).toBeVisible();
  await page.locator('#eventoNombre').fill('Concurso Internacional');
  await page.locator('#eventoFecha').fill(start);
  await page.locator('.evento-rondas-empty').click();
  await page.locator('.evento-ronda-name').fill('Eliminatoria');
  await page.locator('.evento-ronda-date').fill(start);
  await page.locator('.evento-ronda-add').click();
  await page.locator('.evento-ronda-name').nth(1).fill('Final');
  await page.locator('.evento-ronda-date').nth(1).fill(final);
  await page.locator('#modalAddEvento .modal-btn.primary').click();

  const saved = await page.evaluate(() => db.eventos[0]);
  expect(saved.rondas.map(ronda => ronda.nombre)).toEqual(['Eliminatoria', 'Final']);
  expect(saved.fechaFin).toBe(final);
  await expect(page.locator('#eventosList .evento-card')).toContainText('Concurso Internacional');
  await expect(page.locator('#eventosList .evento-round-preview')).toHaveCount(2);
  await expect(page.locator('#eventosList .evento-readiness')).toHaveCount(0);
  await expect(page.locator('#eventosList .evento-meta80')).toHaveCount(0);

  for (const viewport of [{ width: 390, height: 844 }, { width: 1024, height: 768 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => ({
      documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      cardFits: document.querySelector('#eventosList .evento-card').scrollWidth <= document.querySelector('#eventosList .evento-card').clientWidth + 1,
    }));
    expect(layout.documentFits, 'document at ' + viewport.width + 'px').toBe(true);
    expect(layout.cardFits, 'event card at ' + viewport.width + 'px').toBe(true);
  }

  await page.evaluate(() => {
    openEventoResultado(db.eventos[0].id);
    confirmEventoResultado();
  });
  const historyCard = page.locator('#eventosPasadosList .evento-history-card');
  await expect(historyCard).toHaveCount(1);
  await expect(historyCard).toContainText('✓');
  await expect(historyCard).toContainText('Concurso Internacional');
  await expect(historyCard).toContainText('2 rondas');
  await expect(historyCard.locator('.evento-score-badge')).toHaveCount(0);
});

test('keeps the app inside the viewport at the four target widths', async ({ browser }) => {
  test.setTimeout(90_000);
  for (const viewport of [{ width: 390, height: 844 }, { width: 834, height: 1194 }, { width: 1024, height: 768 }, { width: 1280, height: 720 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    for (const view of ['pulse', 'session', 'cronometro', 'obras', 'calendario', 'historial', 'ajustes']) {
      await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
      const sizing = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
      expect(sizing.scrollWidth, view + ' at ' + viewport.width + 'px').toBeLessThanOrEqual(sizing.innerWidth + 1);
    }
    await context.close();
  }
});

test('keeps mobile navigation visible after removing the daily state panel', async ({ browser }) => {
  test.setTimeout(60_000);
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
      hasLegacyStatePanel: Boolean(document.querySelector('.session-ritmo-panel')),
      hasDayPlanner: Boolean(document.getElementById('blockedDayGrid')),
    }));
    expect(state.navFits).toBe(true);
    expect(state.documentFits).toBe(true);
    expect(state.navButtons).toHaveLength(5);
    expect(state.navButtons.every(btn => btn.width > 0 && btn.height >= 44 && btn.label)).toBe(true);
    expect(state.hasLegacyStatePanel).toBe(false);
    expect(state.hasDayPlanner).toBe(true);
    await context.close();
  }
});

test('implements the second visual batch across header, type, theme and motion', async ({ page }) => {
  await prepare(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });

  const state = await page.evaluate(() => {
    showView('session');
    setFontSize('large');
    setThemeMode('dark');
    window.scrollTo(0, 1000);
    showView('obras');
    const active = document.querySelector('.view.active');
    const activeStyles = getComputedStyle(active);
    const bodyBefore = getComputedStyle(document.body, '::before');
    return {
      title: document.getElementById('headerTitle')?.textContent.trim(),
      eyebrow: document.getElementById('headerEyebrow')?.textContent.trim(),
      dateHidden: document.getElementById('headerDate')?.hidden,
      currentView: document.body.dataset.view,
      activeNav: document.querySelector('.nav-btn[aria-current="page"]')?.dataset.view,
      fontOptions: document.querySelectorAll('.font-option').length,
      sizes: [...document.querySelectorAll('.size-option')].map(button => button.dataset.size),
      size: document.documentElement.dataset.size,
      theme: document.documentElement.dataset.theme,
      darkModeChecked: document.querySelector('.theme-mode-option[data-theme-mode="dark"]')?.getAttribute('aria-checked'),
      rootZoom: document.documentElement.style.zoom,
      bodyTransform: document.body.style.transform,
      scrollY: window.scrollY,
      viewAnimation: activeStyles.animationName,
      viewTransform: activeStyles.transform,
      backgroundAnimation: bodyBefore.animationName,
    };
  });

  expect(state.title).toBe('Obras');
  expect(state.eyebrow).toBe('Repertorio');
  expect(state.dateHidden).toBe(true);
  expect(state.currentView).toBe('obras');
  expect(state.activeNav).toBe('obras');
  expect(state.fontOptions).toBe(0);
  expect(state.sizes).toEqual(['small', 'normal', 'large']);
  expect(state.size).toBe('large');
  expect(state.theme).toBe('marmol-night');
  expect(state.darkModeChecked).toBe('true');
  expect(state.rootZoom).toBe('');
  expect(state.bodyTransform).toBe('');
  expect(state.scrollY).toBe(0);
  expect(state.viewAnimation).toBe('none');
  expect(state.viewTransform).toBe('none');
  expect(state.backgroundAnimation).toBe('none');
  await expect(page.locator('#headerSettingsBtn')).toHaveAttribute('aria-label', 'Abrir ajustes');
});

test('keeps phase two grids and touch targets usable at mobile and iPad widths', async ({ browser }) => {
  test.setTimeout(60_000);
  for (const viewport of [{ width: 320, height: 844 }, { width: 834, height: 1194 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    const state = await page.evaluate(() => {
      setFontSize('large');
      const gear = document.getElementById('headerSettingsBtn');
      const gearSize = [gear.getBoundingClientRect().width, gear.getBoundingClientRect().height];
      showView('ajustes');
      const body = document.querySelector('#view-ajustes .ajustes-body');
      const stats = document.querySelector('.session-stats-grid');
      return {
        viewport: window.innerWidth,
        documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
        bottomNavFits: document.querySelector('.nav.nav-bottom').scrollWidth <= document.querySelector('.nav.nav-bottom').clientWidth,
        navHeights: [...document.querySelectorAll('.nav.nav-bottom .nav-btn')].map(button => button.getBoundingClientRect().height),
        gearSize,
        settingsColumns: getComputedStyle(body).gridTemplateColumns,
        statsDisplay: getComputedStyle(stats).display,
      };
    });
    expect(state.documentFits).toBe(true);
    expect(state.bottomNavFits).toBe(true);
    expect(state.navHeights.every(height => height >= 44)).toBe(true);
    expect(state.gearSize).toEqual([44, 44]);
    if (viewport.width >= 768) {
      expect(state.settingsColumns.split(' ').length).toBeGreaterThan(1);
      expect(state.statsDisplay).toBe('grid');
    } else {
      expect(state.settingsColumns).toBe('none');
      expect(state.statsDisplay).toBe('block');
    }
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

test('renders and explores the mystery house prototype on mobile and iPad', async ({ browser }, testInfo) => {
  test.setTimeout(60_000);
  for (const viewport of [
    { width: 430, height: 932, name: 'mobile' },
    { width: 844, height: 390, name: 'mobile-landscape' },
    { width: 834, height: 1194, name: 'ipad-portrait' },
    { width: 1024, height: 768, name: 'ipad-landscape' },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    await page.evaluate(() => showView('casa'));
    await expect(page.locator('#view-casa')).toHaveClass(/active/);
    await expect(page.locator('#houseCanvasHost canvas')).toBeVisible();
    await page.waitForFunction(() => window.__mysteryHouseDebug?.samplePixels().unique > 4);

    const pixels = await page.evaluate(() => window.__mysteryHouseDebug.samplePixels());
    expect(pixels.colored).toBeGreaterThan(40);
    expect(pixels.unique).toBeGreaterThan(4);

    await page.locator('[data-house-floor="3"]').click();
    await expect(page.locator('#houseFloorTitle')).toHaveText('Planta sin número');
    await page.locator('#houseDoorOpen').click();
    const state = await page.evaluate(() => window.__mysteryHouseDebug.getState());
    expect(state.discoveredDoors).toContain('small-sun');

    const layout = await page.evaluate(() => ({
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      stageX: document.getElementById('houseStage').getBoundingClientRect().x,
      stageY: document.getElementById('houseStage').getBoundingClientRect().y,
      stageHeight: document.getElementById('houseStage').getBoundingClientRect().height,
      viewportHeight: window.innerHeight,
    }));
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth + 1);
    expect(layout.stageX).toBeLessThanOrEqual(1);
    expect(layout.stageY).toBeLessThanOrEqual(1);
    expect(layout.stageHeight).toBeLessThan(layout.viewportHeight);
    expect(layout.stageHeight).toBeGreaterThan(layout.viewportHeight - 90);

    const screenshotPath = testInfo.outputPath(`casa-${viewport.name}.png`);
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach(`casa-${viewport.name}.png`, { path: screenshotPath, contentType: 'image/png' });
    await context.close();
  }
});

test('keeps one daily challenge visible in idle and running timer layouts', async ({ browser }) => {
  test.setTimeout(60_000);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 834, height: 1194 },
    { width: 1024, height: 768 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    await page.evaluate(() => {
      showView('cronometro');
      openHabitChallengeModal();
    });
    await page.locator('#habitTitleInput').fill('Practicar escalas');
    await page.locator('#habitDurationInput').fill('14');
    await page.locator('#modalHabitChallenge .modal-btn.primary').click();

    const idleTrophy = page.locator('[data-habit-slot="idle"] .crono-habit-trophy');
    await expect(idleTrophy).toBeVisible();
    await expect(idleTrophy).toHaveAttribute('aria-label', /Practicar escalas/);
    await expect(page.locator('[data-habit-slot="idle"] .crono-habit-card')).toHaveCount(0);
    await idleTrophy.click();
    await expect(page.locator('#modalHabitChallenge')).toHaveClass(/visible/);
    await page.locator('#modalHabitChallenge .modal-btn.secondary').click();

    await page.evaluate(() => {
      crono.state = 'running';
      crono.mode = 'stopwatch';
      crono.isRest = false;
      crono.obraId = 'obra_1';
      crono.displayName = 'Bach · Preludio';
      crono.startTs = Date.now() - 5 * 60000;
      crono.pausedMs = 0;
      crono.targetMinutes = null;
      crono.targetDurationMs = null;
      cronoRender();
    });
    const runningTrophy = page.locator('[data-habit-slot="running"] .crono-habit-trophy');
    await expect(runningTrophy).toBeVisible();
    await expect(runningTrophy).toHaveAttribute('aria-label', /Practicar escalas/);
    await expect(page.locator('[data-habit-slot="running"] .crono-habit-card')).toHaveCount(0);
    await runningTrophy.click();
    await page.locator('#habitTodayBtn').click();
    await expect(runningTrophy).toHaveAttribute('aria-label', /cumplido hoy/);
    await page.locator('#modalHabitChallenge .modal-btn.secondary').click();
    const layout = await page.evaluate(() => {
      const card = document.querySelector('[data-habit-slot="running"] .crono-habit-trophy').getBoundingClientRect();
      const stage = document.getElementById('cronoStageRun').getBoundingClientRect();
      return {
        contained: card.left >= stage.left - 1 && card.right <= stage.right + 1,
        documentFits: document.documentElement.scrollWidth <= window.innerWidth + 1,
      };
    });
    expect(layout.contained).toBe(true);
    expect(layout.documentFits).toBe(true);
    if (viewport.width === 390) {
      const originalId = await page.evaluate(() => db.habitChallenge.id);
      await page.evaluate(() => openHabitChallengeModal());
      await page.locator('#habitDurationInput').fill('30');
      await page.locator('#modalHabitChallenge .modal-btn.primary').click();
      expect(await page.evaluate(() => ({ id: db.habitChallenge.id, days: db.habitChallenge.durationDays }))).toEqual({ id: originalId, days: 30 });

      await page.evaluate(() => {
        db.habitChallenge = {
          id: 'avoid-test', title: 'No coger el móvil en el baño', mode: 'avoid', durationDays: 7,
          startDate: habitDayKey(), logs: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        };
        db.habitChallenges = [];
        renderHabitChallenge();
      });
      page.once('dialog', dialog => dialog.accept());
      await page.locator('[data-habit-slot="running"] .crono-habit-trophy').click();
      await page.locator('#habitTodayBtn').click();
      await expect(page.locator('[data-habit-slot="running"] .crono-habit-trophy')).toHaveAttribute('aria-label', /incumplido hoy/);
      expect(await page.evaluate(() => habitLogStatus(db.habitChallenge.logs[habitDayKey()]))).toBe('failed');
    }
    await context.close();
  }
});

test('uses a dedicated daily challenge composition on mobile', async ({ browser }) => {
  test.setTimeout(45_000);
  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await prepare(page);
    const layout = await page.evaluate(async () => {
      showView('cronometro');
      db.habitChallenge = {
        id: 'mobile-habit', title: 'No coger el móvil en el baño', mode: 'avoid', durationDays: 21,
        startDate: habitDayKey(), logs: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      db.habitChallenges = [];
      renderHabitChallenge();
      await new Promise(resolve => setTimeout(resolve, 320));
      const rect = selector => {
        const box = document.querySelector(selector).getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
      };
      const trophy = rect('[data-habit-slot="idle"] .crono-habit-trophy');
      const slot = rect('[data-habit-slot="idle"]');
      const picker = rect('.crono-idle-work-picker');
      const head = rect('.crono-idle-head');
      const main = rect('.crono-idle-main');
      const start = rect('#cronoStartBtn');
      return {
        trophy, slot, picker, head, main, start,
        hasIdleCard: !!document.querySelector('[data-habit-slot="idle"] .crono-habit-card'),
        trophyLabel: document.querySelector('[data-habit-slot="idle"] .crono-habit-trophy').getAttribute('aria-label'),
        modeOptions: document.querySelectorAll('#cronoModeToggle .crono-mode-opt').length,
        hasUntilMode: !!document.querySelector('#cronoModeToggle [data-mode="until"]'),
        hasUntilRow: !!document.getElementById('cronoUntilRow'),
      };
    });

    expect(layout.trophy.left).toBeGreaterThanOrEqual(layout.head.left);
    expect(layout.trophy.right).toBeLessThanOrEqual(layout.head.right);
    expect(layout.trophy.top).toBeGreaterThanOrEqual(layout.head.top);
    expect(layout.trophy.bottom).toBeLessThanOrEqual(layout.head.bottom);
    expect(Math.abs((layout.trophy.top + layout.trophy.bottom) / 2 - (layout.picker.top + layout.picker.bottom) / 2)).toBeLessThanOrEqual(5);
    expect(layout.slot.height).toBeLessThanOrEqual(44);
    expect(layout.hasIdleCard).toBe(false);
    expect(layout.trophyLabel).toContain('No coger el móvil en el baño');
    expect(layout.modeOptions).toBe(2);
    expect(layout.hasUntilMode).toBe(false);
    expect(layout.hasUntilRow).toBe(false);
    if (viewport.width < viewport.height) {
      expect(layout.trophy.width).toBeGreaterThanOrEqual(44);
      expect(layout.trophy.height).toBeGreaterThanOrEqual(44);
    } else {
      expect(layout.trophy.height).toBeLessThanOrEqual(31);
      expect(layout.start.bottom).toBeLessThanOrEqual(layout.main.bottom + 1);

      await page.evaluate(() => openHabitChallengeModal());
      const modal = await page.evaluate(() => {
        const box = document.querySelector('#modalHabitChallenge .habit-modal');
        const actions = box.querySelector('.habit-modal-actions').getBoundingClientRect();
        return {
          columns: getComputedStyle(box).gridTemplateColumns.split(' ').length,
          fitsWithoutScroll: box.scrollHeight <= box.clientHeight + 1,
          actionsVisible: actions.top >= 0 && actions.bottom <= innerHeight,
          focusedId: document.activeElement?.id || '',
        };
      });
      expect(modal.columns).toBe(2);
      expect(modal.fitsWithoutScroll).toBe(true);
      expect(modal.actionsVisible).toBe(true);
      expect(modal.focusedId).not.toBe('habitTitleInput');
    }
    await context.close();
  }
});

test('keeps exactly one active objective and removes the second-objective controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => {
    showView('cronometro');
    const today = habitDayKey();
    db.habitChallenge = {
      id: 'single-active-test', title: 'No coger el móvil en el baño', mode: 'avoid', durationDays: 21,
      startDate: habitKeyAt(today, -4), logs: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.habitChallenges = [];
    renderHabitChallenge();
  });
  await page.evaluate(() => {
    const today = habitDayKey();
    const habit = db.habitChallenge;
    const legacySecond = {
      id: 'legacy-second', title: 'No coger el móvil en la cama', mode: 'avoid', durationDays: 21,
      startDate: habitKeyAt(today, -2), logs: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.habitChallenges = [habit, legacySecond];
    db.habitChallenge = habit;
    renderHabitChallenge();
  });
  await expect(page.locator('[data-habit-slot="idle"] .crono-habit-trophy')).toHaveCount(1);
  await expect(page.locator('[data-habit-slot="idle"] .crono-habit-trophy-add')).toHaveCount(0);
  expect(await page.evaluate(() => habitActiveChallenges().map(habit => habit.title))).toEqual([
    'No coger el móvil en el baño'
  ]);
  await page.evaluate(() => openHabitChallengeModal());
  await expect(page.locator('#modalHabitChallenge')).toHaveClass(/visible/);
  await expect(page.locator('#modalHabitChallenge .habit-modal-kicker')).toHaveText('Objetivo diario');
  await page.locator('#modalHabitChallenge .modal-btn.secondary').click();
});

test('shows and updates the daily challenge history from calendar', async ({ browser }) => {
  test.setTimeout(60_000);
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
    { width: 834, height: 1194 },
    { width: 1024, height: 768 },
  ]) {
    const context = await browser.newContext({ viewport, hasTouch: true });
    const page = await context.newPage();
    await prepare(page);
    await page.evaluate(() => {
      showView('calendario');
      switchCalTab('objetivos', document.getElementById('calTabObjetivos'));
    });

    await expect(page.locator('#calPanelObjetivos')).toBeVisible();
    await expect(page.locator('.habit-calendar-empty')).toContainText('Sin objetivo activo');
    await expect(page.locator('#calendarActionRow')).toBeHidden();
    await expect(page.locator('#calTabObjetivos')).toHaveAttribute('aria-selected', 'true');

    const dates = await page.evaluate(() => {
      const today = habitDayKey();
      const start = habitKeyAt(today, -4);
      const success = habitKeyAt(start, 3);
      const failure = habitKeyAt(start, 1);
      db.habitChallenge = {
        id: 'calendar-habit', title: 'Practicar escalas', mode: 'do', durationDays: 14,
        startDate: start,
        logs: {
          [start]: { status: 'done', at: new Date().toISOString() },
          [success]: { status: 'done', at: new Date().toISOString() },
        },
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      saveData();
      renderHabitChallenge();
      renderHabitCalendar();
      return { today, success, failure };
    });

    const dashboard = page.locator('.habit-calendar-dashboard');
    await expect(dashboard).toContainText('Practicar escalas');
    await expect(page.locator(`.habit-calendar-day[data-date="${dates.success}"]`)).toHaveClass(/is-success/);
    await expect(page.locator(`.habit-calendar-day[data-date="${dates.failure}"]`)).toHaveClass(/is-failure/);
    await expect(page.locator(`.habit-calendar-day[data-date="${dates.today}"]`)).toHaveClass(/is-current/);
    await page.locator('.habit-calendar-today').click();
    await expect(page.locator('.habit-calendar-today')).toContainText('Cumplido hoy');
    await expect(page.locator(`.habit-calendar-day[data-date="${dates.today}"]`)).toHaveClass(/is-success/);
    expect(await page.evaluate(() => habitLogStatus(db.habitChallenge.logs[habitDayKey()]))).toBe('done');

    const layout = await page.evaluate(() => {
      const panel = document.getElementById('calPanelObjetivos').getBoundingClientRect();
      const dashboard = document.querySelector('.habit-calendar-dashboard').getBoundingClientRect();
      const todayButton = document.querySelector('.habit-calendar-today').getBoundingClientRect();
      return {
        columns: getComputedStyle(document.querySelector('.habit-calendar-grid')).gridTemplateColumns.split(' ').length,
        contained: dashboard.left >= panel.left - 1 && dashboard.right <= panel.right + 1,
        actionHeight: todayButton.height,
        documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });
    expect(layout.columns).toBe(7);
    expect(layout.contained).toBe(true);
    expect(layout.actionHeight).toBeGreaterThanOrEqual(38);
    expect(layout.documentFits).toBe(true);

    const monthBefore = await page.locator('.habit-calendar-month-nav strong').textContent();
    await page.getByRole('button', { name: 'Mes anterior' }).click();
    await expect(page.locator('.habit-calendar-month-nav strong')).not.toHaveText(monthBefore);
    await context.close();
  }
});

test('shows objectives as a layer inside the monthly calendar', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const today = habitDayKey();
    const start = habitKeyAt(today, -20);
    db.habitChallenge = {
      id: 'integrated-calendar-habit', title: 'Leer sin móvil', mode: 'do', durationDays: 21,
      startDate: start,
      logs: { [today]: { status: 'done', at: new Date().toISOString() } },
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveData();
    showView('calendario');
    switchCalTab('mes', document.getElementById('calTabMes'));
  });

  await expect(page.locator('#calPanelMes')).toBeVisible();
  await expect(page.locator('#calPanelObjetivos')).toBeHidden();
  await expect(page.locator('#calendarHabitToggle')).toHaveAttribute('aria-checked', 'false');
  const geometryOff = await page.evaluate(() => ({
    panel: document.getElementById('calPanelMes').getBoundingClientRect().height,
    grid: document.getElementById('mesGrid').getBoundingClientRect().height,
    summary: document.getElementById('calendarHabitSummary').getBoundingClientRect().height,
  }));
  await page.locator('#calendarHabitToggle').click();
  await expect(page.locator('#calendarHabitToggle')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#mesGrid .habit-calendar-month-cell')).not.toHaveCount(0);
  await expect(page.locator('#mesGrid .mes-dot')).toHaveCount(0);
  await expect(page.locator(`.habit-calendar-month-cell[data-date="${await page.evaluate(() => habitDayKey())}"]`)).toHaveClass(/is-victory/);
  const geometryOn = await page.evaluate(() => ({
    panel: document.getElementById('calPanelMes').getBoundingClientRect().height,
    grid: document.getElementById('mesGrid').getBoundingClientRect().height,
    summary: document.getElementById('calendarHabitSummary').getBoundingClientRect().height,
    legend: document.getElementById('mesLeyenda').getBoundingClientRect().height,
  }));
  expect(Math.abs(geometryOn.panel - geometryOff.panel)).toBeLessThanOrEqual(2);
  expect(Math.abs(geometryOn.grid - geometryOff.grid)).toBeLessThanOrEqual(1);
  expect(Math.abs(geometryOn.summary - geometryOff.summary)).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    const today = habitDayKey();
    db.habitChallenge = {
      id: 'integrated-calendar-future', title: 'Leer a diario', mode: 'do', durationDays: 3,
      startDate: today, logs: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveData();
    renderMesCalendario();
  });
  await expect(page.locator('#mesGrid .habit-calendar-month-cell.is-target')).toHaveCount(1);
  await expect(page.locator('#mesGrid .habit-calendar-month-cell.is-target .habit-month-mark')).toHaveText(String.fromCodePoint(9873));
  await expect(page.locator('#mesGrid .habit-calendar-month-cell.is-target')).not.toHaveClass(/is-victory/);

  await page.evaluate(() => {
    const today = habitDayKey();
    db.habitChallenge = {
      id: 'integrated-calendar-avoid', title: 'No coger el móvil', mode: 'avoid', durationDays: 21,
      startDate: habitKeyAt(today, -20), logs: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveData();
    renderMesCalendario();
  });
  const relapse = page.locator('.calendar-habit-icon-action.is-relapse');
  await expect(relapse).toHaveAttribute('aria-label', 'Registrar recaída hoy');
  await expect(relapse).toHaveText('!');
  await page.locator('.calendar-habit-icon-action.is-relapse').click();
  expect(await page.evaluate(() => habitLogStatus(db.habitChallenge.logs[habitDayKey()]))).toBe('failed');
  await expect(page.locator('.calendar-habit-icon-action.is-relapse')).toHaveAttribute('aria-label', 'Quitar recaída de hoy');
  await expect(page.locator('.calendar-habit-icon-edit')).toHaveAttribute('aria-label', 'Editar objetivo');
  await expect(page.locator('#mesLeyenda')).toBeEmpty();
});

test('moves expired objectives to the reward shelf while another objective stays active', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const today = habitDayKey();
    const expired = {
      id: 'expired-reward-test', title: 'No mirar el móvil al despertar', mode: 'avoid', durationDays: 7,
      startDate: habitKeyAt(today, -10), logs: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    const active = {
      id: 'active-after-reward-test', title: 'Estudiar antes de abrir redes', mode: 'do', durationDays: 14,
      startDate: today, logs: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.habitChallenges = [expired, active];
    db.habitChallenge = active;
    saveData();
    showView('calendario');
    switchCalTab('objetivos', document.getElementById('calTabObjetivos'));
  });

  await expect(page.locator('.habit-calendar-dashboard')).toContainText('Estudiar antes de abrir redes');
  await expect(page.locator('.habit-completed-card')).toHaveCount(1);
  await expect(page.locator('.habit-completed-card')).toContainText('No mirar el móvil al despertar');
  await page.locator('.habit-reward-claim').click();
  await expect(page.locator('.habit-reward-claimed')).toContainText('Recogida');
  await expect(page.locator('.habit-reward-coin')).toHaveCount(1);
  await expect(page.locator('.habit-reward-coin')).toHaveAttribute('aria-label', /No mirar el móvil al despertar/);

  await page.evaluate(() => {
    const expired = db.habitChallenges.find(habit => habit.id === 'expired-reward-test');
    db.habitChallenges = [expired];
    db.habitChallenge = expired;
    renderHabitCalendar();
  });
  await expect(page.locator('.habit-calendar-empty')).toContainText('Todos los objetivos están cerrados');
  await expect(page.locator('.habit-calendar-dashboard')).toHaveCount(0);
});

test('marks today with a stronger border in both objective grids', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const today = habitDayKey();
    db.habitChallenge = {
      id: 'today-border-test', title: 'Hoy queda visible', mode: 'do', durationDays: 7,
      startDate: habitKeyAt(today, -2), logs: {},
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    db.habitChallenges = [];
    saveData();
    showView('calendario');
    switchCalTab('objetivos', document.getElementById('calTabObjetivos'));
  });
  await expect(page.locator('.habit-calendar-day.is-today')).toHaveCount(1);
  await expect(page.locator('.habit-calendar-day.is-today')).toHaveCSS('border-width', '2px');
  await page.evaluate(() => {
    showView('calendario');
    switchCalTab('mes', document.getElementById('calTabMes'));
    document.getElementById('calendarHabitToggle').click();
  });
  await expect(page.locator('#mesGrid .habit-calendar-month-cell.is-today')).toHaveCount(1);
  await expect(page.locator('#mesGrid .habit-calendar-month-cell.is-today')).toHaveCSS('border-width', '2px');
});

test('loads the calendar and objectives switch inside the stopwatch', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await prepare(page);
  await page.evaluate(() => {
    const today = habitDayKey();
    db.habitChallenge = {
      id: 'timer-habit', title: 'Practicar escalas', mode: 'do', durationDays: 14,
      startDate: today, logs: {}, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    };
    saveData();
    renderHabitChallenge();
    renderHabitCalendar();
    showView('cronometro');
  });

  const calendarTab = page.locator('.crono-calendar-objectives-tab[data-timer-panel="calendar"]');
  const objectivesTab = page.locator('.crono-calendar-objectives-tab[data-timer-panel="objectives"]');
  await expect(calendarTab).toBeVisible();
  await expect(objectivesTab).toBeVisible();
  await expect(objectivesTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cronoObjectivesPanel .crono-habit-tracker-action-icon')).toHaveAttribute('aria-label', 'Marcar objetivo cumplido hoy');
  await expect(page.locator('#cronoObjectivesPanel .crono-habit-tracker-action-icon')).toHaveText(String.fromCodePoint(10003));
  await expect(page.locator('#cronoObjectivesPanel .crono-habit-tracker-edit-icon')).toHaveAttribute('aria-label', 'Editar objetivo');
  await expect(page.locator('#cronoObjectivesPanel .crono-habit-tracker-head')).toHaveCount(0);
  await expect(page.locator('#cronoObjectivesPanel .crono-habit-tracker-stats')).toHaveCount(0);
  await expect(page.locator('#cronoObjectivesPanel .crono-habit-tracker-foot')).toHaveCount(0);

  const portraitLayout = await page.evaluate(() => {
    const shell = document.getElementById('cronoCalendarObjectivesShell').getBoundingClientRect();
    const panel = document.getElementById('cronoObjectivesPanel').getBoundingClientRect();
    const tracker = document.querySelector('#cronoObjectivesPanel .crono-habit-tracker').getBoundingClientRect();
    const clock = document.querySelector('#cronoStageIdle .crono-idle-main').getBoundingClientRect();
    const days = getComputedStyle(document.querySelector('#cronoObjectivesPanel .crono-habit-tracker-days'));
    const day = document.querySelector('#cronoObjectivesPanel .crono-habit-day').getBoundingClientRect();
    return {
      shellWidth: shell.width,
      panelContainsTracker: tracker.left >= panel.left - 1 && tracker.right <= panel.right + 1,
      balancedHeight: Math.abs(shell.height - clock.height),
      dayColumns: days.gridTemplateColumns.split(' ').length,
      dayWidth: day.width,
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });
  expect(portraitLayout.shellWidth).toBeGreaterThan(300);
  expect(portraitLayout.panelContainsTracker).toBe(true);
  expect(portraitLayout.balancedHeight).toBeLessThanOrEqual(2);
  expect(portraitLayout.dayColumns).toBe(7);
  expect(portraitLayout.dayWidth).toBeGreaterThanOrEqual(32);
  expect(portraitLayout.documentFits).toBe(true);

  const sizeToggle = page.locator('#cronoPanelSizeToggle');
  await expect(sizeToggle).toBeVisible();
  await sizeToggle.click();
  await expect(sizeToggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('body')).toHaveClass(/crono-dashboard-compact/);
  await sizeToggle.click();
  await expect(sizeToggle).toHaveAttribute('aria-pressed', 'false');

  await page.setViewportSize({ width: 1194, height: 834 });
  const landscapeLayout = await page.evaluate(() => {
    const shell = document.getElementById('cronoCalendarObjectivesShell').getBoundingClientRect();
    const tracker = document.querySelector('#cronoObjectivesPanel .crono-habit-tracker').getBoundingClientRect();
    const clock = document.querySelector('#cronoStageIdle .crono-idle-main').getBoundingClientRect();
    return {
      visible: shell.width > 0 && shell.height > 0,
      contained: tracker.left >= shell.left - 1 && tracker.right <= shell.right + 1,
      balancedHeight: Math.abs(shell.height - clock.height),
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });
  expect(landscapeLayout.visible).toBe(true);
  expect(landscapeLayout.contained).toBe(true);
  expect(landscapeLayout.balancedHeight).toBeLessThanOrEqual(2);
  expect(landscapeLayout.documentFits).toBe(true);

  await calendarTab.click();
  await expect(calendarTab).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#cronoCalendarPanelInner')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#cronoObjectivesPanel')).toBeHidden();
});

test('hides pulse by default and lets settings restore it while tasks remain scrollable', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await prepare(page);
  await page.evaluate(() => showView('cronometro'));

  const pulse = page.locator('#view-cronometro .crono-moment-monitor');
  await expect(pulse).toBeHidden();
  expect(await page.evaluate(() => ({
    stored: localStorage.getItem('alberto_crono_pulse_visible_v1'),
    disabled: document.body.classList.contains('crono-pulse-disabled'),
  }))).toEqual({ stored: null, disabled: true });
  expect(await page.locator('#cronoIdleDrawer').evaluate(el => ({
    gridColumn: getComputedStyle(el).gridColumn,
    width: el.getBoundingClientRect().width,
  }))).toEqual(expect.objectContaining({ gridColumn: '1 / -1' }));

  const taskLists = page.locator('#cronoIdleTasksPanel .crono-task-lane .crono-task-list');
  expect(await taskLists.count()).toBe(2);
  const taskList = taskLists.nth(0);
  expect(await taskList.evaluate(el => ({ overflowY: getComputedStyle(el).overflowY, maxHeight: getComputedStyle(el).maxHeight }))).toEqual(expect.objectContaining({ overflowY: 'auto' }));

  await page.evaluate(() => showView('ajustes'));
  const pulseToggle = page.locator('#cronoPulseToggleBtn');
  await expect(pulseToggle).toHaveAttribute('aria-checked', 'false');
  await pulseToggle.click();
  await expect(pulseToggle).toHaveAttribute('aria-checked', 'true');
  await page.evaluate(() => showView('cronometro'));
  await expect(pulse).toBeVisible();
  expect(await page.evaluate(() => document.body.classList.contains('crono-pulse-enabled'))).toBe(true);
});

test('adds manual study to today from the compact quick row', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => showView('session'));

  const quick = page.locator('#sessionQuickStudy');
  await expect(quick).toBeVisible();
  await expect(page.locator('#modalStudyRegister')).not.toHaveClass(/visible/);
  await page.locator('#sessionQuickStudyObra').selectOption('obra::obra_1');
  await page.locator('[data-quick-study-minutes="25"]').click();
  await expect(page.locator('#sessionQuickStudySave')).toBeEnabled();
  await page.locator('#sessionQuickStudySave').click();

  await expect(quick).toHaveClass(/is-saved/);
  await expect(page.locator('#sessionQuickStudyFeedback')).toContainText('25 min añadidos');
  await expect(page.locator('#sessionResumenCard .session-resumen-big')).toHaveText('25 min');
  const saved = await page.evaluate(() => ({
    sessions: db.sesiones.map(session => session.items.map(item => ({ obraId: item.obraId, minutes: item.minutosEstudiados, manual: item.manual }))),
    plants: db.sessionPlants.map(plant => ({ obraId: plant.obraId, minutes: plant.mins, source: plant.source })),
    pref: JSON.parse(localStorage.getItem('alberto_quick_study_v1')),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  expect(saved.sessions).toEqual([[{ obraId: 'obra_1', minutes: 25, manual: true }]]);
  expect(saved.plants).toEqual([{ obraId: 'obra_1', minutes: 25, source: 'manual' }]);
  expect(saved.pref).toEqual({ value: 'obra::obra_1', minutes: 25 });
  expect(saved.documentWidth).toBeLessThanOrEqual(saved.viewportWidth + 1);

  await page.evaluate(() => {
    document.getElementById('sessionQuickStudyObra').value = '';
    document.getElementById('sessionQuickStudyMinutes').value = '';
    renderSessionQuickStudy();
  });
  await expect(page.locator('#sessionQuickStudyObra')).toHaveValue('obra::obra_1');
  await expect(page.locator('#sessionQuickStudyMinutes')).toHaveValue('25');
});

test('adds custom study quickly and persists both history and timed detail', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => showView('session'));
  await page.locator('#sessionStatsSection .stats-primary-add').click();

  const modal = page.locator('#modalStudyRegister');
  await expect(modal).toHaveClass(/visible/);
  await expect(page.locator('#studyRegisterTitle')).toHaveText('Añadir estudio');
  await expect(page.locator('#studyModeRow')).toBeHidden();
  await expect(page.locator('#studyRegisterDetails')).not.toHaveAttribute('open', '');
  await expect(page.locator('#studyRegisterFecha')).toHaveValue(await page.evaluate(() => sessionJournalDayKey(new Date())));
  const yesterday = await page.evaluate(() => {
    const date = new Date();
    date.setDate(date.getDate() - 1);
    return sessionJournalDayKey(date);
  });
  await page.locator('#studyDatePresets [data-date-offset="-1"]').click();
  await expect(page.locator('#studyRegisterFecha')).toHaveValue(yesterday);
  await expect(page.locator('#studyDatePresets [data-date-offset="-1"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('#studyRegisterObra').selectOption('obra::obra_1');
  await page.locator('#studyMinutePresets [data-minutes="25"]').click();
  await expect(page.locator('#studyRegisterMinutos')).toHaveValue('25');
  await expect(page.locator('#studyMinutePresets [data-minutes="25"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#studyRegisterSaveBtn').click();
  await expect(modal).not.toHaveClass(/visible/);

  const saved = await page.evaluate(() => ({
    sessions: db.sesiones.map(session => ({
      date: session.date,
      items: session.items.map(item => ({ obraId: item.obraId, minutes: item.minutosEstudiados, manual: item.manual })),
    })),
    plants: db.sessionPlants.map(plant => ({ obraId: plant.obraId, minutes: plant.mins, source: plant.source })),
    local: JSON.parse(localStorage.getItem('alberto_piano_v2')),
  }));
  expect(saved.sessions).toHaveLength(1);
  expect(saved.sessions[0].date).toContain(yesterday);
  expect(saved.sessions[0].items).toEqual([{ obraId: 'obra_1', minutes: 25, manual: true }]);
  expect(saved.plants).toEqual([{ obraId: 'obra_1', minutes: 25, source: 'manual' }]);
  expect(saved.local.sessionPlants).toHaveLength(1);
  expect(await page.evaluate(() => getMinutosConcentradoHoy())).toBe(0);

  await page.evaluate(() => showView('historial'));
  await expect(page.locator('#statsDashboard')).toContainText('25 min');
});

test('adds manual study to today total immediately', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => showView('session'));
  await page.locator('#sessionStatsSection .stats-primary-add').click();
  await page.locator('#studyRegisterObra').selectOption('obra::obra_1');
  await page.locator('#studyMinutePresets [data-minutes="25"]').click();
  await page.locator('#studyRegisterSaveBtn').click();

  await expect(page.locator('#modalStudyRegister')).not.toHaveClass(/visible/);
  await expect(page.locator('#sessionConcentradoText')).toHaveText(/25 min/);
  expect(await page.evaluate(() => getMinutosConcentradoHoy())).toBe(25);
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

test('implements phase three Hoy and Cronómetro hierarchy', async ({ page }) => {
  await prepare(page);
  const state = await page.evaluate(() => {
    showView('session');
    db.dailyGoalMinutes = 240;
    renderSessionResumen();
    const hoy = {
      nav: document.querySelector('.nav-btn[data-view="session"]')?.textContent.trim(),
      action: document.getElementById('sessionStartStudyBtn')?.textContent.trim() || null,
      journal: {
        label: document.getElementById('sessionJournalToggle')?.getAttribute('aria-label'),
        text: document.getElementById('sessionJournalToggle')?.textContent.trim(),
        expanded: document.getElementById('sessionJournalToggle')?.getAttribute('aria-expanded'),
        panelHidden: document.getElementById('sessionJournalPanel')?.hidden,
      },
      nudge: document.querySelector('.session-insight-card.nudge'),
      refresh: (() => {
        const button = document.querySelector('#view-session .app-refresh-btn');
        return !!button;
      })(),
    };
    showView('cronometro');
    const cronoRefresh = document.querySelector('#view-cronometro .app-refresh-btn');
    const cronoRefreshBox = cronoRefresh?.getBoundingClientRect();
    return {
      hoy,
      cronoStart: document.getElementById('cronoStartBtn')?.textContent.trim(),
      quickNoteButtons: document.querySelectorAll('#cronoQuickNoteBtn').length,
      runTabs: [...document.querySelectorAll('#cronoRunDrawer .crono-run-drawer-tab')].map(button => button.dataset.tab || button.dataset.action),
      bottomDisplay: getComputedStyle(document.querySelector('#view-cronometro .crono-bottom-row')).display,
      cronoRefresh: { label: cronoRefresh?.getAttribute('aria-label'), width: cronoRefreshBox?.width, height: cronoRefreshBox?.height, hasIcon: !!cronoRefresh?.querySelector('svg') },
    };
  });
  expect(state.hoy.nav).toBe('Hoy');
  expect(state.hoy.action).toBeNull();
  expect(state.hoy.journal).toEqual({
    label: 'Añadir una entrada al diario',
    text: '+',
    expanded: 'false',
    panelHidden: true,
  });
  expect(state.hoy.nudge).toBeNull();
  expect(state.hoy.refresh).toBe(false);
  expect(state.cronoStart).toBe('Iniciar');
  expect(state.quickNoteButtons).toBe(0);
  expect(state.runTabs).toEqual(['tareas', 'memoria', 'metronomo', 'pase']);
  expect(state.bottomDisplay).toBe('none');
  expect(state.cronoRefresh).toEqual({ label: 'Comprobar actualización', width: 44, height: 44, hasIcon: true });

  await page.evaluate(() => showView('session'));
  await page.locator('#sessionJournalToggle').click();
  await expect(page.locator('#sessionJournalPanel')).toBeVisible();
  await expect(page.locator('#sessionJournalInput')).toBeFocused();
  await page.locator('#sessionJournalInput').fill('Escuchar la toma de hoy');
  await page.locator('.session-journal-submit').click();
  await expect(page.locator('#sessionJournalPanel')).toBeHidden();
  expect(await page.evaluate(() => sessionJournalTodayEntries().at(-1)?.text)).toBe('Escuchar la toma de hoy');
});

test('progressively reveals Obras tools and keeps evolution samples honest', async ({ page }) => {
  await prepare(page);
  const sparse = await page.evaluate(() => {
    showView('obras');
    const view = document.getElementById('view-obras');
    return {
      sparse: view.classList.contains('obras-sparse'),
      toolbar: getComputedStyle(view.querySelector('.obras-toolbar')).display,
      primaryText: view.querySelector('.obra-primary-pase')?.textContent || '',
      hasEstimate: /80%|mantenimiento recomendado|horas sugeridas/i.test(view.textContent),
    };
  });
  expect(sparse.sparse).toBe(true);
  expect(sparse.toolbar).toBe('none');
  expect(sparse.primaryText).toContain('Registrar pase');
  expect(sparse.hasEstimate).toBe(false);

  const rich = await page.evaluate(() => {
    db.obras.push(
      { id: 'obra_2', name: 'Obra dos', composer: 'Compositor', tipo: 'obra', movimientos: [], sol: 50, solHistory: [], paseHistory: [] },
      { id: 'obra_3', name: 'Obra tres', composer: 'Compositor', tipo: 'obra', movimientos: [], sol: 50, solHistory: [], paseHistory: [] },
    );
    renderObras();
    document.getElementById('obrasMoreToggle')?.click();
    const view = document.getElementById('view-obras');
    return {
      sparse: view.classList.contains('obras-sparse'),
      moreOpen: view.classList.contains('obras-more-open'),
      sortDisplay: getComputedStyle(view.querySelector('.obras-sort-row')).display,
      moreText: document.getElementById('obrasMoreToggle')?.textContent.trim(),
    };
  });
  expect(rich.sparse).toBe(false);
  expect(rich.moreOpen).toBe(true);
  expect(rich.sortDisplay).toBe('flex');
  expect(rich.moreText).toBe('Menos');

  const graph = await page.evaluate(() => {
    const now = Date.now();
    db.obras[0].paseHistory = [
      { date: new Date(now - 3 * 86400000).toISOString(), score: 4, tipo: 'solo', note: 'uno' },
      { date: new Date(now - 2 * 86400000).toISOString(), score: 6, tipo: 'informal', note: 'dos' },
    ];
    openGrafico('obra_1', null);
    renderGraficoSvg();
    const short = {
      list: document.getElementById('graficoAccessibleList')?.textContent || '',
      svg: !!document.querySelector('#graficoSvgWrap svg'),
      insufficient: !!document.querySelector('.grafico-insufficient'),
    };
    db.obras[0].paseHistory.push(
      { date: new Date(now - 1 * 86400000).toISOString(), score: 7, tipo: 'solo' },
      { date: new Date(now - 12 * 3600000).toISOString(), score: 8, tipo: 'solo' },
      { date: new Date(now - 6 * 3600000).toISOString(), score: 9, tipo: 'evento' },
    );
    renderGraficoSvg();
    return { short, long: { svg: !!document.querySelector('#graficoSvgWrap svg'), scale: document.getElementById('graficoSvgWrap')?.textContent.includes('%') } };
  });
  expect(graph.short.list).toContain('uno');
  expect(graph.short.svg).toBe(false);
  expect(graph.short.insufficient).toBe(true);
  expect(graph.long.svg).toBe(true);
  expect(graph.long.scale).toBe(true);
});

test('adapts the running timer to iPad landscape and portrait', async ({ browser }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 834, height: 1194 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    const layout = await page.evaluate(() => {
      showView('cronometro');
      db.cronoPasajes = [
        { id: 'pj_1', name: 'Coda · cc. 200–208', tier: 'red', createdAt: new Date().toISOString(), focusHistory: [], solHistory: [] },
        { id: 'pj_2', name: 'Octavas · cc. 119–126', tier: 'amber', createdAt: new Date().toISOString(), focusHistory: [], solHistory: [] },
      ];
      cronoSetMode('timer');
      cronoSetTimerPreset(25);
      const select = document.getElementById('cronoObraSelect');
      select.value = 'obra::obra_1';
      cronoSetObservation('Coda limpia, pulso estable');
      cronoUpdateStartBtn();
      cronoStart();
      crono.startTs = Date.now() - 12 * 60 * 1000;
      cronoRender();
      renderCronoPasajes();

      const stage = document.getElementById('cronoStageRun').getBoundingClientRect();
      const drawer = document.getElementById('cronoRunDrawer').getBoundingClientRect();
      const controls = document.getElementById('cronoControls').getBoundingClientRect();
      const ring = document.querySelector('#cronoStageRun .crono-run-progress-svg').getBoundingClientRect();
      const display = document.getElementById('cronoDisplay');
      const displayRange = document.createRange();
      displayRange.selectNodeContents(display);
      const displayTextWidth = displayRange.getBoundingClientRect().width;
      const sessionButton = document.querySelector('#cronoControls .crono-session-rail-main');
      const actionRail = document.querySelector('#cronoStageRun .crono-run-action-rail').getBoundingClientRect();
      const sideDestello = document.querySelector('#cronoStageRun .crono-run-side-destello').getBoundingClientRect();
      const displayBox = document.getElementById('cronoDisplay').getBoundingClientRect();
      const sessionButtonBox = sessionButton?.getBoundingClientRect();
      return {
        portrait: matchMedia('(orientation: portrait)').matches,
        stage: { top: stage.top, right: stage.right, bottom: stage.bottom },
        drawer: { top: drawer.top, left: drawer.left, bottom: drawer.bottom },
        controlsBottom: controls.bottom,
        viewportHeight: innerHeight,
        fitsWidth: document.documentElement.scrollWidth <= innerWidth + 1,
        objectiveRemoved: !document.getElementById('cronoRunObjective') && !document.getElementById('cronoRunObjectiveText'),
        removedDrawerSections: !document.getElementById('cronoRunObservation') && !document.getElementById('cronoPasajesSection'),
        displayRatio: displayTextWidth / ring.width,
        circleIsButton: document.getElementById('cronoDisplayWrap').hasAttribute('role'),
        hasSeparateControl: !!sessionButton,
        controlPastClockCenter: sideDestello.left > (displayBox.left + displayBox.right) / 2,
        pauseBelowDestello: !!sessionButtonBox && sessionButtonBox.top >= sideDestello.bottom - 1,
        actionRailPastClockCenter: actionRail.left > (displayBox.left + displayBox.right) / 2,
        controlInsideClock: !!sessionButtonBox && document.getElementById('cronoStageRun').contains(sessionButton),
        controlOutsideTools: !!sessionButtonBox && !document.getElementById('cronoRunDrawer').contains(sessionButton),
      };
    });

    expect(layout.fitsWidth).toBe(true);
    expect(layout.objectiveRemoved).toBe(true);
    expect(layout.removedDrawerSections).toBe(true);
    expect(layout.displayRatio).toBeLessThanOrEqual(0.78);
    expect(layout.circleIsButton).toBe(false);
    expect(layout.hasSeparateControl).toBe(true);
    expect(layout.controlPastClockCenter).toBe(true);
    expect(layout.pauseBelowDestello).toBe(true);
    expect(layout.actionRailPastClockCenter).toBe(true);
    expect(layout.controlInsideClock).toBe(true);
    expect(layout.controlOutsideTools).toBe(true);
    if (layout.portrait) {
      expect(layout.drawer.top).toBeGreaterThanOrEqual(layout.stage.bottom);
      expect(layout.controlsBottom).toBeLessThanOrEqual(layout.viewportHeight + 1);
    } else {
      expect(layout.drawer.left).toBeGreaterThanOrEqual(layout.stage.right);
      expect(Math.abs(layout.drawer.top - layout.stage.top)).toBeLessThanOrEqual(16);
    }
    await context.close();
  }
});

test('cancels or confirms a valid timer and saves visual solidity', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async dialog => {
    nativeDialogs += 1;
    await dialog.dismiss();
  });
  await prepare(page);
  await page.evaluate(() => {
    db.cronoTasks = [
      { id: 'ct_break', text: 'Responder el mensaje pendiente', kind: 'personal', priority: 3, done: false, createdAt: new Date().toISOString() },
      { id: 'ct_break_piano', text: 'Anotar la digitación de la coda', kind: 'piano', done: false, createdAt: new Date().toISOString() },
    ];
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoSetObservation('Pulso estable');
    cronoUpdateStartBtn();
    cronoStart();
    crono.startTs = Date.now() - 25 * 60 * 1000;
    cronoSaveState();
    cronoStop();
  });

  const confirm = page.locator('#modalCronoConfirmFinish');
  await expect(confirm).toHaveClass(/visible/);
  await expect(confirm.locator('#cronoFinishConfirmDur')).toHaveText('25:00');
  await expect(confirm.locator('#cronoFinishConfirmWork')).toContainText('Bach');
  expect(await page.evaluate(() => db.sessionPlants.length)).toBe(0);
  await confirm.getByRole('button', { name: 'Cancelar' }).click();
  await expect(confirm).not.toHaveClass(/visible/);
  expect(await page.evaluate(() => ({ state: crono.state, saved: db.sessionPlants.length }))).toEqual({ state: 'running', saved: 0 });

  await page.evaluate(() => cronoStop());
  await expect(confirm).toHaveClass(/visible/);
  await confirm.getByRole('button', { name: 'Hecho' }).click();

  const modal = page.locator('#modalHechoDatos');
  await expect(modal).toHaveClass(/visible/);
  await expect(modal.locator('#hechoSavedMinutes')).toHaveText('25 min guardados');
  expect(nativeDialogs).toBe(0);

  const stable = modal.locator('#hechoSolidezSlider');
  await expect(modal.locator('.hecho-solidez-meter')).toBeVisible();
  await expect(modal.locator('.hecho-solidez-options')).toHaveCount(0);
  await stable.fill('65');
  await expect(stable).toHaveValue('65');
  await modal.getByRole('button', { name: 'Hecho' }).click();
  await expect(modal).not.toHaveClass(/visible/);

  const taskBreak = page.locator('#modalCronoTaskBreak');
  await expect(taskBreak).toHaveClass(/visible/);
  await expect(taskBreak).toContainText('¿Un descanso?');
  await expect(taskBreak).toContainText('Responder el mensaje pendiente');
  await expect(taskBreak.locator('.crono-task-break-item.priority-3')).toContainText('Urgentísima');
  await taskBreak.getByRole('button', { name: /Responder el mensaje pendiente/ }).click({ force: true });
  await expect(taskBreak.locator('.crono-task-break-item.is-completing')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => db.cronoTasks.find(task => task.id === 'ct_break')?.done)).toBe(true);
  await taskBreak.getByRole('button', { name: 'OK, cerrar' }).click();
  await expect(taskBreak).not.toHaveClass(/visible/);

  const saved = await page.evaluate(() => ({
    value: db.obras[0].solHistory[0]?.val,
    context: db.obras[0].solHistory[0]?.context,
    current: db.obras[0].sol,
  }));
  expect(saved).toEqual({ value: 65, context: 'cierre-sesion', current: 65 });
  const averaged = await page.evaluate(() => recordSessionSolidez('obra_1', null, 85, new Date(Date.now() + 86400000).toISOString()));
  expect(averaged).toBe(75);
});

test('shows work and movement totals together while a movement is running', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    db.obras[0].movimientos = [
      { id: 'movement-a', name: 'I. Allegro', duracion: 100 },
      { id: 'movement-b', name: 'II. Largo', duracion: 50 },
    ];
    const now = new Date();
    db.sesiones = [{ date: now.toISOString(), items: [
      { obraId: 'obra_1', movId: 'movement-a', estudiado: true, tick: 'hecho', minutosReales: 42 },
      { obraId: 'obra_1', movId: 'movement-b', estudiado: true, tick: 'hecho', minutosReales: 18 },
    ] }];
    db.sessionPlants = [
      { id: 'movement-a-history', obraId: 'obra_1', movId: 'movement-a', startedAt: new Date(now - 42 * 60000).toISOString(), endedAt: new Date(now - 5 * 60000).toISOString(), mins: 42 },
      { id: 'movement-b-history', obraId: 'obra_1', movId: 'movement-b', startedAt: new Date(now - 80 * 60000).toISOString(), endedAt: new Date(now - 62 * 60000).toISOString(), mins: 18 },
    ];
    crono.state = 'running';
    crono.isRest = false;
    crono.obraId = 'obra_1';
    crono.movId = 'movement-a';
    crono.displayName = 'I. Allegro';
    crono.subName = 'Bach · Preludio';
    crono.startTs = Date.now() - 5 * 60000;
    crono.pausedMs = 0;
    crono.color = null;
    showView('cronometro');
    cronoRender();
  });
  await expect(page.locator('#cronoRunWorkTotal')).toHaveText('1h 5min');
  await expect(page.locator('#cronoRunMovementTotal')).toHaveText('47 min');
  await expect(page.locator('.crono-run-work-total-separator')).toBeVisible();
  await expect(page.locator('#cronoRunMovementTotal')).toHaveAttribute('aria-label', 'Tiempo total de este movimiento: 47 min');
});

test('discards only the active timer and preserves earlier study from today', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const before = await page.evaluate(() => {
    const endedAt = new Date(Date.now() - 30 * 60 * 1000);
    db.sessionPlants.push({
      id: 'already-saved-today',
      obraId: 'obra_1',
      startedAt: new Date(endedAt.getTime() - 40 * 60 * 1000).toISOString(),
      endedAt: endedAt.toISOString(),
      mins: 40,
      source: 'app',
    });
    saveData();
    const savedTotal = getMinutosConcentradoHoy();
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoUpdateStartBtn();
    cronoStart();
    crono.startTs = Date.now() - 18 * 60 * 1000;
    crono.notes = [{ id: 'pending-note', text: 'No debe guardarse', at: new Date().toISOString() }];
    crono.quickDestelloNote = 'Destello pendiente';
    cronoSaveState();
    window.__discardedPushRunId = null;
    if (window.StudyPush) {
      window.StudyPush.cancelRun = runId => { window.__discardedPushRunId = runId; return Promise.resolve(true); };
    }
    const runId = crono.runId;
    cronoStop();
    return { savedTotal, liveTotal: getMinutosConcentradoHoy(), runId };
  });

  const confirm = page.locator('#modalCronoConfirmFinish');
  await expect(confirm).toHaveClass(/visible/);
  await expect(confirm.getByRole('button', { name: /Eliminar solamente esta sesión/ })).toBeVisible();

  for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
    await page.setViewportSize(viewport);
    const layout = await confirm.evaluate(overlay => {
      const modal = overlay.querySelector('.crono-finish-confirm-modal');
      const actions = [...overlay.querySelectorAll('button')];
      const box = modal.getBoundingClientRect();
      return {
        fits: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
        actionHeights: actions.map(button => button.getBoundingClientRect().height),
        overflow: modal.scrollWidth <= modal.clientWidth + 1,
      };
    });
    expect(layout.fits).toBe(true);
    expect(layout.overflow).toBe(true);
    expect(layout.actionHeights).toHaveLength(3);
    expect(layout.actionHeights.every(height => height >= 44)).toBe(true);
  }

  await confirm.getByRole('button', { name: /Eliminar solamente esta sesión/ }).click();
  await expect(confirm).not.toHaveClass(/visible/);

  const after = await page.evaluate(() => ({
    state: crono.state,
    runId: crono.runId,
    notes: crono.notes,
    quickDestelloNote: crono.quickDestelloNote,
    savedIds: db.sessionPlants.map(session => session.id),
    total: getMinutosConcentradoHoy(),
    storedState: JSON.parse(localStorage.getItem('pianoCrono_v2')),
    discardedPushRunId: window.__discardedPushRunId,
  }));
  expect(after.state).toBe('idle');
  expect(after.runId).toBeNull();
  expect(after.notes).toEqual([]);
  expect(after.quickDestelloNote).toBe('');
  expect(after.savedIds).toEqual(['already-saved-today']);
  expect(before.liveTotal).toBe(before.savedTotal);
  expect(after.total).toBe(before.savedTotal);
  expect(after.storedState.state).toBe('idle');
  expect(after.storedState.runId).toBeNull();
  expect(after.discardedPushRunId).toBe(before.runId);
});

test('keeps tasks available while idle and compacts long running content', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  await page.evaluate(() => {
    showView('cronometro');
    db.cronoTasks = [
      { id: 'ct_1', text: 'Afinar el bajo de la coda', done: false, createdAt: new Date().toISOString() },
    ];
    db.cronoPasajes = Array.from({ length: 5 }, (_, index) => ({
      id: 'pj_' + index,
      name: 'Pasaje ' + (index + 1) + ' · compases ' + (20 + index * 4) + '–' + (23 + index * 4),
      tier: index < 2 ? 'red' : 'amber',
      createdAt: new Date().toISOString(),
      focusHistory: [],
      solHistory: [],
    }));
    cronoRender();
    renderCronoPasajes();
  });

  await page.locator('#cronoIdleDrawer .crono-idle-drawer-tab[data-tab="tareas"]').click();
  const idleTasks = page.locator('#cronoIdleTasksPanel');
  await expect(idleTasks).toContainText('Afinar el bajo de la coda');
  await expect(idleTasks.locator('#cronoIdleTaskInput')).toHaveCount(0);
  await idleTasks.getByRole('button', { name: 'Añadir tarea de Piano' }).click();
  await expect(idleTasks.locator('#cronoIdleTaskInput')).toBeFocused();
  await idleTasks.locator('#cronoIdleTaskInput').fill('Revisar digitación final');
  await idleTasks.locator('.crono-task-add-btn').click();
  await expect(idleTasks).toContainText('Revisar digitación final');
  await expect(idleTasks.locator('#cronoIdleTaskInput')).toHaveCount(0);

  const metrics = await page.evaluate(() => {
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoUpdateStartBtn();
    cronoStart();
    crono.startTs = Date.now() - 65 * 60 * 1000;
    cronoRender();
    renderCronoPasajes();

    const destello = document.getElementById('cronoRunDestello');
    const longText = 'Una repetición consciente puede ser lenta, pero debe conservar el sonido, la dirección y la sensación exacta que quieres encontrar mañana sin añadir tensión innecesaria.';
    destello.className = 'crono-run-destello size-xlong';
    destello.innerHTML = '<span class="crono-run-destello-text">' + longText + '</span>';
    destello.style.display = '';

    const ring = document.querySelector('#cronoStageRun .crono-run-progress-svg').getBoundingClientRect();
    const display = document.getElementById('cronoDisplay');
    const displayRange = document.createRange();
    displayRange.selectNodeContents(display);
    const displayTextWidth = displayRange.getBoundingClientRect().width;
    const taskBadge = document.getElementById('cronoDrawerTaskTabCount');
    const taskBadgeStyle = getComputedStyle(taskBadge);
    const taskTab = document.querySelector('#cronoRunDrawer .crono-run-drawer-tab[data-tab="tareas"]');
    const passageRows = [...document.querySelectorAll('.crono-focus-pasaje-main')];
    return {
      ringWidth: ring.width,
      displayWidth: displayTextWidth,
      hasHours: document.getElementById('cronoDisplayWrap').classList.contains('has-hours'),
      destelloFits: destello.scrollHeight <= destello.clientHeight + 1,
      destelloOverflow: getComputedStyle(destello).overflow,
      destelloClamp: getComputedStyle(destello.querySelector('.crono-run-destello-text')).webkitLineClamp,
      destelloFontSize: parseFloat(getComputedStyle(destello).fontSize),
      passageCount: passageRows.length,
      maxPassageHeight: Math.max(...passageRows.map(row => row.getBoundingClientRect().height)),
      openPassages: document.querySelectorAll('.crono-focus-pasaje.is-open').length,
      taskDot: {
        hidden: taskBadge.hidden,
        text: taskBadge.textContent,
        width: taskBadge.getBoundingClientRect().width,
        height: taskBadge.getBoundingClientRect().height,
        radius: taskBadgeStyle.borderRadius,
        background: taskBadgeStyle.backgroundColor,
      },
      taskTabClass: taskTab.className,
      taskTabLabel: taskTab.getAttribute('aria-label'),
    };
  });

  expect(metrics.ringWidth).toBeGreaterThanOrEqual(350);
  expect(metrics.hasHours).toBe(true);
  expect(metrics.displayWidth).toBeLessThanOrEqual(metrics.ringWidth * 0.78);
  expect(metrics.destelloFits).toBe(true);
  expect(metrics.destelloOverflow).toBe('hidden');
  expect(metrics.destelloClamp).toBe('4');
  expect(metrics.destelloFontSize).toBeGreaterThanOrEqual(13);
  expect(metrics.passageCount).toBe(5);
  expect(metrics.maxPassageHeight).toBeLessThanOrEqual(45);
  expect(metrics.openPassages).toBe(0);
  expect(metrics.taskDot.hidden).toBe(false);
  expect(metrics.taskDot.text).toBe('2');
  expect(metrics.taskDot.width).toBe(20);
  expect(metrics.taskDot.height).toBe(20);
  expect(metrics.taskDot.radius).toBe('50%');
  expect(metrics.taskDot.background).toBe('rgb(185, 28, 28)');
  expect(metrics.taskTabClass).toContain('has-tasks');
  expect(metrics.taskTabLabel).toBe('Tareas, 2 pendientes');

  await page.locator('#cronoRunDrawer .crono-run-drawer-tab[data-tab="tareas"]').click();
  await expect(page.locator('#cronoTasksPanel')).toContainText('Revisar digitación final');
  await page.locator('#cronoRunDrawer .crono-run-drawer-tab[data-action="pase"]').click();
  await expect(page.locator('#modalCronoPaseRapido')).toHaveClass(/visible/);
  await expect(page.locator('#cronoPaseSelectionSummary')).toHaveText('1 seleccionada');
  await expect(page.locator('#cronoPaseSelectionList .crono-pase-picker-item.is-selected')).toHaveCount(1);
  expect(await page.evaluate(() => crono.state)).toBe('running');
});

test('selects several recent works before rating and saving their passes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => {
    db.obras = [
      { id: 'obra_a', name: 'Obra antigua', composer: 'A', tipo: 'obra', movimientos: [], paseHistory: [] },
      { id: 'obra_b', name: 'Obra reciente', composer: 'B', tipo: 'obra', movimientos: [], paseHistory: [] },
      { id: 'obra_c', name: 'Obra intermedia', composer: 'C', tipo: 'obra', movimientos: [], paseHistory: [] },
    ];
    localStorage.setItem('cronoPickRecency', JSON.stringify({ obra_a: 100, obra_b: 300, obra_c: 200 }));
    openCronoPaseRapido();
  });

  const modal = page.locator('#modalCronoPaseRapido');
  const choices = modal.locator('.crono-pase-picker-item');
  await expect(choices).toHaveCount(3);
  await expect(choices.nth(0)).toContainText('Obra reciente');
  await expect(choices.nth(1)).toContainText('Obra intermedia');
  await expect(choices.nth(2)).toContainText('Obra antigua');

  await choices.nth(0).click();
  await choices.nth(2).click();
  await expect(modal).toHaveClass(/visible/);
  await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'true');
  await expect(choices.nth(2)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cronoPaseSelectionSummary')).toHaveText('2 seleccionadas');

  await choices.nth(0).click();
  await expect(choices.nth(0)).toHaveAttribute('aria-pressed', 'false');
  await choices.nth(1).click();
  await page.locator('#cronoPaseContinueBtn').click();

  await expect(page.locator('#cronoPaseSelectStage')).toBeHidden();
  await expect(page.locator('#cronoPaseDetailStage')).toBeVisible();
  const cards = page.locator('#cronoPaseItems .crono-pase-item');
  await expect(cards).toHaveCount(2);
  await expect(cards.locator('.pase-liquid-input')).toHaveCount(2);
  await cards.nth(0).locator('.pase-liquid-input').fill('35');
  await cards.nth(1).locator('.pase-liquid-input').fill('82');
  await page.locator('#cronoPaseComment').fill('Afinar el ataque y sostener mejor el final');
  await modal.getByRole('button', { name: 'Guardar pases' }).click();
  await expect(modal).not.toHaveClass(/visible/);

  const saved = await page.evaluate(() => ({
    ancient: findObra('obra_a').paseHistory.length,
    middle: findObra('obra_c').paseHistory.length,
    recent: findObra('obra_b').paseHistory.length,
    middleNote: findObra('obra_c').paseHistory[0]?.note,
  }));
  expect(saved).toEqual({
    ancient: 1,
    middle: 1,
    recent: 0,
    middleNote: 'Afinar el ataque y sostener mejor el final',
  });

  await page.evaluate(() => openCronoPaseRapido());
  await expect(page.locator('.crono-pase-picker-item').nth(0)).toContainText('Obra intermedia');
});

test('edits an hourly study block and updates the daily total', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await prepare(page);
  await page.evaluate(() => {
    const now = new Date();
    const started = new Date(now.getTime() - 120 * 60000);
    const ended = now;
    const startIso = started.toISOString();
    const endIso = ended.toISOString();
    db.sessionPlants = [{ id: 'editable-block', obraId: 'obra_1', movId: null, startedAt: startIso, endedAt: endIso, mins: 120, source: 'app' }];
    db.sesiones = [{
      date: now.toISOString(),
      items: [{ _planId: 'plan_edit', obraId: 'obra_1', movId: null, obraName: 'Bach · Preludio', tick: 'hecho', estudiado: true, minutosReales: 120, minutosPlan: 120 }],
      _aggregate: { plan_edit: { subsessions: [{ startedAt: startIso, endedAt: endIso, min: 120 }] } },
    }];
    openSesionesDetalle();
  });

  const modal = page.locator('#modalSesionesDetalle');
  await expect(modal).toHaveClass(/visible/);
  await modal.locator('.sesdet-edit-btn').first().click();
  await modal.locator('[data-field="minutes"]').fill('90');
  await modal.locator('.sesdet-save').click();

  const state = await page.evaluate(() => ({
    plant: db.sessionPlants[0].mins,
    item: db.sesiones[0].items[0].minutosReales,
    aggregate: db.sesiones[0]._aggregate.plan_edit.subsessions[0].min,
    today: getMinutosConcentradoHoy(),
  }));
  expect(state).toEqual({ plant: 90, item: 90, aggregate: 90, today: 90 });
  await expect(modal).toContainText('90 min');
});

test('records recording passes with takes and a score for each work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => {
    db.obras = [
      { id: 'obra_grabacion', name: 'Ligeti', composer: 'G.', tipo: 'obra', movimientos: [], paseHistory: [] },
    ];
    openCronoPaseRapido();
  });

  await page.locator('#cronoPaseSelectionList .crono-pase-picker-item').click();
  await page.locator('#cronoPaseContinueBtn').click();
  await page.locator('#modalCronoPaseRapido .pase-tipo-btn.grabacion').click();
  await page.locator('.crono-pase-item').first().locator('.pase-liquid-input').fill('82');
  await page.locator('.crono-pase-item').first().locator('.crono-pase-takes input').fill('4');
  await page.getByRole('button', { name: 'Guardar pases' }).click();

  const state = await page.evaluate(() => ({
    pase: findObra('obra_grabacion').paseHistory[0],
    plant: db.sessionPlants.find(item => item.source === 'pase'),
  }));
  expect(state.pase).toMatchObject({ tipo: 'grabacion', score: 8, solidezPct: 82, takes: 4 });
  expect(state.plant).toMatchObject({ pase: true, paseTipo: 'grabacion', paseScore: 8, pasePct: 82, takes: 4 });
});

test('keeps competition passes distinct from general events', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => {
    db.obras = [
      { id: 'obra_concurso', name: 'Prokofiev', composer: 'S.', tipo: 'obra', movimientos: [], paseHistory: [], solHistory: [], escHistory: [] },
    ];
    openCronoPaseRapido();
  });

  await page.locator('#cronoPaseSelectionList .crono-pase-picker-item').click();
  await page.locator('#cronoPaseContinueBtn').click();
  await page.locator('#modalCronoPaseRapido .pase-tipo-btn.concurso').click();
  await page.locator('.crono-pase-item').first().locator('.pase-liquid-input').fill('76');
  await page.getByRole('button', { name: 'Guardar pases' }).click();

  const state = await page.evaluate(() => ({
    pase: findObra('obra_concurso').paseHistory[0],
    plant: db.sessionPlants.find(item => item.source === 'pase'),
    stageContext: findObra('obra_concurso').escHistory[0]?.context,
  }));
  expect(state.pase).toMatchObject({ tipo: 'concurso', score: 8, solidezPct: 76 });
  expect(state.plant).toMatchObject({ pase: true, paseTipo: 'concurso', paseScore: 8, pasePct: 76 });
  expect(state.stageContext).toBe('pase-concurso');
});

test('configures a work map, records a visual fault and shows it in pass history', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await prepare(page);
  await page.evaluate(() => {
    db.obras = [
      { id: 'obra_mapa', name: 'Sonata', composer: 'A.', tipo: 'obra', movimientos: [], paseHistory: [], solHistory: [], escHistory: [] },
    ];
    openCronoPaseRapido();
  });

  await page.locator('#cronoPaseSelectionList .crono-pase-picker-item').click();
  await page.locator('#cronoPaseContinueBtn').click();
  await page.locator('.crono-pase-item .pase-fault-launch').click();
  await expect(page.locator('#modalPaseFaultMap')).toHaveClass(/visible/);

  await page.locator('#paseFaultTotalBars').fill('300');
  await page.locator('#paseFaultTotalBars').press('Tab');
  await page.locator('.pase-fault-section-row input[type="text"]').fill('Exposición y desarrollo');
  await page.locator('.pase-fault-type.suciedad').click();
  const timeline = page.locator('#paseFaultTimeline');
  const box = await timeline.boundingBox();
  await timeline.click({ position: { x: box.width * 0.5, y: box.height * 0.45 } });
  await page.locator('.pase-fault-label input').fill('Entrada del desarrollo');
  await page.getByRole('button', { name: 'Guardar mapa' }).click();

  await expect(page.locator('.crono-pase-item .pase-fault-launch')).toContainText('1 marca');
  await page.locator('.crono-pase-item .pase-liquid-input').fill('74');
  await page.getByRole('button', { name: 'Guardar pases' }).click();

  const state = await page.evaluate(() => {
    const obra = findObra('obra_mapa');
    openGrafico('obra_mapa', null);
    renderGraficoSvg();
    return { map: obra.paseFaultMap, fault: obra.paseHistory[0].faults[0] };
  });
  expect(state.map).toMatchObject({ totalBars: 300, configured: true });
  expect(state.fault).toMatchObject({ type: 'suciedad', label: 'Entrada del desarrollo' });
  expect(state.fault.bar).toBeGreaterThanOrEqual(145);
  expect(state.fault.bar).toBeLessThanOrEqual(155);
  await expect(page.locator('#graficoFaultMap .pase-fault-marker.suciedad')).toHaveCount(1);
  await expect(page.locator('#graficoFaultMap')).toContainText('1 marca');

  await page.evaluate(() => openEditPase('obra_mapa', null, findObra('obra_mapa').paseHistory[0].id, ''));
  await expect(page.locator('#paseQFaultBtn')).toContainText('1 marca');
  await page.locator('#paseQFaultBtn').click();
  await expect(page.locator('#paseFaultTimeline .pase-fault-marker')).toHaveCount(1);
  await page.locator('.pase-fault-type.memoria').click();
  const editTimeline = page.locator('#paseFaultTimeline');
  const editBox = await editTimeline.boundingBox();
  await editTimeline.click({ position: { x: editBox.width * 0.75, y: editBox.height * 0.45 } });
  await page.locator('.pase-fault-label input').fill('Recuerdo de la coda');
  await page.getByRole('button', { name: 'Guardar mapa' }).click();
  await page.locator('#paseQSaveBtn').click();
  expect(await page.evaluate(() => findObra('obra_mapa').paseHistory[0].faults)).toHaveLength(2);
  await page.evaluate(() => {
    const obra = findObra('obra_mapa');
    obra.paseHistory.unshift({
      id: 'pase_repetido', date: new Date(Date.now() + 1000).toISOString(), score: 6, tipo: 'solo',
      faults: [{ id: 'fault_repetido', type: 'suciedad', position: 0.51, bar: 153, label: 'Entrada del desarrollo' }],
    });
    renderGraficoSvg();
  });
  await expect(page.locator('#graficoFaultMap')).toContainText('1 zona recurrente');
  await expect(page.locator('#graficoFaultMap .pase-fault-marker.suciedad b')).toHaveText('2');
});

test('keeps the pass save action visible and supports repeated passes per work', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    db.obras = Array.from({ length: 12 }, (_, index) => ({
      id: 'many-' + index,
      name: 'Obra ' + (index + 1),
      composer: 'Compositor',
      tipo: 'obra',
      movimientos: [],
      paseHistory: [],
    }));
    openCronoPaseRapido();
  });
  const choices = page.locator('#cronoPaseSelectionList .crono-pase-picker-item');
  await expect(choices).toHaveCount(12);
  for (let index = 0; index < 12; index += 1) await choices.nth(index).click();
  await page.locator('#cronoPaseContinueBtn').click();
  const modal = page.locator('#modalCronoPaseRapido');
  const geometry = await page.evaluate(() => {
    const list = document.getElementById('cronoPaseItems');
    const save = document.querySelector('#modalCronoPaseRapido .crono-pase-detail-stage .modal-btn.primary');
    const modalBox = document.querySelector('#modalCronoPaseRapido .modal').getBoundingClientRect();
    const saveBox = save.getBoundingClientRect();
    return { scrolls: list.scrollHeight > list.clientHeight, saveVisible: saveBox.bottom <= modalBox.bottom + 1 && saveBox.top >= modalBox.top - 1 };
  });
  expect(geometry.scrolls).toBe(true);
  expect(geometry.saveVisible).toBe(true);

  const passCountInput = page.locator('#cronoPaseItems input[aria-label="Numero de pases"]').first();
  await passCountInput.fill('3');
  await expect(page.locator('#cronoPaseItems .crono-pase-item')).toHaveCount(14);

  await page.evaluate(() => {
    cronoPaseDraft = cronoPaseDraft.filter(item => item.targetKey === 'many-0::');
    cronoPaseRender();
    document.getElementById('cronoPaseFecha').value = '2026-08-01';
  });
  const firstPassIndices = await page.locator('#cronoPaseItems .crono-pase-item').evaluateAll(nodes => nodes
    .map((node, index) => ({ index, name: node.querySelector('.crono-pase-item-name')?.firstChild?.textContent?.trim() }))
    .filter(item => item.name === 'Obra 1')
    .map(item => item.index));
  expect(firstPassIndices).toHaveLength(3);
  await page.locator('#cronoPaseItems .crono-pase-item').nth(firstPassIndices[0]).locator('.pase-liquid-input').fill('18');
  await page.locator('#cronoPaseItems .crono-pase-item').nth(firstPassIndices[1]).locator('.pase-liquid-input').fill('61');
  await page.locator('#cronoPaseItems .crono-pase-item').nth(firstPassIndices[2]).locator('.pase-liquid-input').fill('97');
  await modal.getByRole('button', { name: 'Guardar pases' }).click();
  const result = await page.evaluate(() => db.obras[0].paseHistory.map(entry => ({ pct: entry.solidezPct, date: entry.date.slice(0, 10) })));
  expect(result).toEqual([
    { pct: 97, date: '2026-08-01' },
    { pct: 61, date: '2026-08-01' },
    { pct: 18, date: '2026-08-01' },
  ]);
});

test('edits a previous pass by date, type and result from the evolution history', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    db.obras[0].paseHistory = [{
      id: 'previous-pass', date: '2026-08-01T12:00:00.000Z', score: 2,
      solidezPct: 11, quality: 'mal', tipo: 'solo', takes: null, note: 'Antes',
    }];
    showView('obras');
    openGrafico('obra_1', null);
  });
  const history = page.locator('#graficoAccessibleList');
  await expect(history).toContainText('Editar');
  await history.getByRole('button', { name: 'Editar' }).click();
  await expect(page.locator('#modalPaseQuality')).toHaveClass(/visible/);
  await expect(page.locator('#paseQualityTitle')).toHaveText('Editar pase');
  await page.locator('#paseQFecha').fill('2026-08-03');
  await page.locator('#modalPaseQuality .pase-tipo-btn.grabacion').click();
  await page.locator('#paseQTakes').fill('4');
  await page.locator('#paseQPercent').fill('84');
  await page.locator('#paseQNote').fill('Ahora estable');
  await page.getByRole('button', { name: 'Guardar' }).click();
  const edited = await page.evaluate(() => db.obras[0].paseHistory[0]);
  expect(edited).toMatchObject({ id: 'previous-pass', score: 8, solidezPct: 84, tipo: 'grabacion', takes: 4, note: 'Ahora estable' });
  expect(edited.date.slice(0, 10)).toBe('2026-08-03');
});

test('opens pending tasks once per day and repeats the reminder after two hours', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await prepare(page);
  await page.evaluate(() => {
    db.cronoTasks = [
      { id: 'ct_reminder', text: 'Repasar la coda sin pedal', done: false, createdAt: new Date().toISOString() },
      { id: 'ct_done', text: 'Afinar', done: true, createdAt: new Date().toISOString() },
    ];
    localStorage.removeItem(CRONO_TASK_REMINDER_KEY);
    showView('cronometro');
  });

  const drawer = page.locator('#cronoIdleDrawer');
  await expect(drawer).toHaveAttribute('data-tab', 'tareas');
  await expect(page.locator('#cronoIdleTasksPanel .crono-task-reminder-banner')).toContainText('Tienes 1 tarea de piano pendiente');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

  const cooldown = await page.evaluate(() => {
    cronoSetIdleDrawerTab('pasajes');
    return { reminded: cronoMaybeRemindTasks('enter'), tab: document.getElementById('cronoIdleDrawer').dataset.tab };
  });
  expect(cooldown).toEqual({ reminded: false, tab: 'pasajes' });

  await page.evaluate(() => {
    const state = cronoTaskReminderState();
    state.lastAt = Date.now() - CRONO_TASK_REMINDER_MS - 1000;
    localStorage.setItem(CRONO_TASK_REMINDER_KEY, JSON.stringify(state));
    cronoSetIdleDrawerTab('pasajes');
    _hechoSubSession = true;
    _hechoObraId = 'obra_1';
    closeHechoDatos(false);
  });
  await expect(drawer).toHaveAttribute('data-tab', 'tareas');
  expect(await page.evaluate(() => cronoTaskReminderState().reason)).toBe('session-end');
});

test('separates piano and personal tasks and only reminds piano work', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  await page.evaluate(() => {
    showView('cronometro');
    cronoSetIdleDrawerTab('tareas');
  });

  const panel = page.locator('#cronoIdleTasksPanel');
  await expect(panel.locator('#cronoIdleTaskInput')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Añadir tarea de Piano' }).click();
  await expect(panel.locator('#cronoIdleTaskInput')).toBeFocused();
  await panel.locator('.crono-task-tomorrow-btn').click();
  await panel.locator('#cronoIdleTaskInput').fill('Estudiar la coda sin pedal');
  await panel.locator('.crono-task-add-btn').click();
  await expect(panel.locator('.crono-task-lane.piano')).toContainText('Estudiar la coda sin pedal');
  await expect(panel.locator('.crono-task-lane.piano .crono-task-due-tag')).toHaveText('Mañana');

  await panel.getByRole('button', { name: 'Añadir tarea de Personal' }).click();
  await expect(panel.locator('.crono-task-tomorrow-btn')).toBeHidden();
  await panel.locator('#cronoIdleTaskInput').fill('Escribir a Emma');
  await panel.locator('.crono-task-add-btn').click();
  await expect(panel.locator('.crono-task-lane.personal')).toContainText('Escribir a Emma');

  const landscape = await page.evaluate(() => ({
    saved: cronoTasks().map(task => ({ text: task.text, kind: task.kind, tomorrow: task.tomorrow })),
    controlsInMain: !!document.querySelector('.crono-idle-main > .crono-idle-controls'),
    controlsInDrawer: !!document.querySelector('#cronoIdleDrawer .crono-idle-controls'),
    taskColumns: getComputedStyle(document.querySelector('.crono-task-columns')).gridTemplateColumns.split(' ').length,
  }));
  expect(landscape.saved).toEqual([
    { text: 'Estudiar la coda sin pedal', kind: 'piano', tomorrow: true },
    { text: 'Escribir a Emma', kind: 'personal', tomorrow: false },
  ]);
  expect(landscape.controlsInMain).toBe(true);
  expect(landscape.controlsInDrawer).toBe(false);
  expect(landscape.taskColumns).toBe(2);

  await page.evaluate(() => {
    for (let index = 0; index < 5; index += 1) {
      cronoTasks().push({
        id: 'done_old_' + index,
        text: 'Tarea antigua ' + index,
        kind: 'piano',
        done: true,
        createdAt: new Date(Date.now() - (index + 10) * 86400000).toISOString(),
        doneAt: new Date(Date.now() - (index + 2) * 86400000).toISOString(),
      });
    }
    renderCronoTasks();
  });
  const pianoRow = panel.locator('.crono-task-lane.piano .crono-task-row').first();
  await pianoRow.locator('.crono-task-toggle').click();
  expect(await pianoRow.evaluate(row => row.classList.contains('is-completing'))).toBe(true);
  await expect(panel.locator('.crono-task-lane.piano .crono-task-clean')).toContainText('Todo limpio');
  const completed = panel.locator('.crono-task-lane.piano .crono-task-completed');
  await expect(completed.locator('summary')).toContainText('6 hechas');
  await expect(completed).not.toHaveAttribute('open', '');
  await expect(completed.locator('.crono-task-row').first()).toBeHidden();
  await completed.locator('summary').click();
  await expect(completed).toHaveAttribute('open', '');
  await expect(completed.locator('.crono-task-row').first()).toContainText('Estudiar la coda sin pedal');
  await expect(completed.locator('.crono-task-row').first()).toBeVisible();
  await completed.locator('summary').click();
  await expect(completed).not.toHaveAttribute('open', '');
  const personalOnly = await page.evaluate(() => {
    localStorage.removeItem(CRONO_TASK_REMINDER_KEY);
    cronoSetIdleDrawerTab('pasajes');
    return { reminded: cronoMaybeRemindTasks('test'), tab: document.getElementById('cronoIdleDrawer').dataset.tab };
  });
  expect(personalOnly).toEqual({ reminded: false, tab: 'tareas' });

  await page.setViewportSize({ width: 834, height: 1194 });
  await page.evaluate(() => {
    cronoTasks().push({
      id: 'personal_second_column', text: 'Llamar al luthier', kind: 'personal', done: false,
      createdAt: new Date().toISOString(), priority: 0,
    });
    renderCronoTasks();
    cronoSetIdleDrawerTab('tareas');
  });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.crono-task-columns')).gridTemplateColumns.split(' ').length)).toBe(1);
  expect(await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#cronoIdleTasksPanel .crono-task-lane.personal .crono-task-row:not(.is-wide)')];
    return new Set(rows.map(row => Math.round(row.getBoundingClientRect().left))).size;
  })).toBe(2);
  await expect(completed.locator('.crono-task-row').first()).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('starts task dictation automatically and keeps manual editing available', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await prepare(page);
  await page.evaluate(() => {
    window.__taskRecognitionInstances = [];
    window.SpeechRecognition = class {
      constructor() { window.__taskRecognitionInstances.push(this); }
      start() { this.started = true; }
      stop() { this.stopped = true; this.onend?.(); }
      abort() { this.aborted = true; this.onend?.(); }
    };
    showView('cronometro');
    cronoSetIdleDrawerTab('tareas');
  });

  const panel = page.locator('#cronoIdleTasksPanel');
  await panel.getByRole('button', { name: 'Añadir tarea de Personal' }).click();
  await expect(panel.locator('#cronoIdleTaskInput')).toBeFocused();
  await expect(panel.locator('#cronoTaskVoiceBtn-idle')).toHaveClass(/is-listening/);
  expect(await page.evaluate(() => window.__taskRecognitionInstances[0]?.started)).toBe(true);

  await page.evaluate(() => {
    window.__taskRecognitionInstances[0].onresult({ results: [[{ transcript: 'Recordar la postura' }]] });
  });
  await expect(panel.locator('#cronoIdleTaskInput')).toHaveValue('Recordar la postura');
  await panel.locator('#cronoIdleTaskInput').fill('Recordar la postura al tocar');
  await panel.locator('.crono-task-add-btn').click();

  expect(await page.evaluate(() => cronoTasks().at(-1))).toMatchObject({
    text: 'Recordar la postura al tocar', kind: 'personal', done: false,
  });
  expect(await page.evaluate(() => window.__taskRecognitionInstances[0]?.stopped)).toBe(true);
  await expect(panel.locator('.crono-task-lane.personal')).toContainText('Recordar la postura al tocar');
});

test('uses the task circle to toggle and the task name to edit', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await prepare(page);
  await page.evaluate(() => {
    db.cronoTasks = [{
      id: 'ct_editable',
      text: 'Revisar digitación',
      kind: 'piano',
      tomorrow: false,
      done: false,
      createdAt: new Date().toISOString(),
    }];
    showView('cronometro');
    cronoSetIdleDrawerTab('tareas');
    renderCronoTasks();
  });

  const panel = page.locator('#cronoIdleTasksPanel');
  const pendingRow = panel.locator('.crono-task-row').first();
  const toggle = pendingRow.locator('.crono-task-toggle');
  const toggleBox = await toggle.boundingBox();
  expect(toggleBox.width).toBeGreaterThanOrEqual(44);
  expect(toggleBox.height).toBeGreaterThanOrEqual(44);

  await pendingRow.locator('.crono-task-open').click();
  await expect(page.locator('#modalCronoTaskEdit')).toHaveClass(/visible/);
  await page.locator('#cronoTaskEditInput').fill('Revisar digitación final');
  await page.locator('#modalCronoTaskEdit').getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('#modalCronoTaskEdit')).not.toHaveClass(/visible/);
  await expect(panel.locator('.crono-task-row').first()).toContainText('Revisar digitación final');
  expect(await page.evaluate(() => cronoTasks()[0].done)).toBe(false);

  await panel.locator('.crono-task-row').first().locator('.crono-task-toggle').click();
  await expect(panel.locator('.crono-task-completed summary')).toContainText('1 hecha');
  await panel.locator('.crono-task-completed summary').click();
  const completedRow = panel.locator('.crono-task-completed-list .crono-task-row').first();
  await expect(completedRow).toContainText('Revisar digitación final');
  await completedRow.locator('.crono-task-toggle').click();
  await expect(panel.locator('.crono-task-row').first()).not.toHaveClass(/is-done/);
  expect(await page.evaluate(() => cronoTasks()[0].done)).toBe(false);
});

test('captures a dictated-style note for tomorrow and keeps the clock tools minimal', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  const idlePosition = await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoUpdateStartBtn();
    const ring = document.querySelector('#cronoStageIdle .crono-run-progress-svg').getBoundingClientRect();
    const note = document.querySelector('#cronoStageIdle .crono-tomorrow-note-btn').getBoundingClientRect();
    return {
      x: (note.left + note.width / 2 - (ring.left + ring.width / 2)) / ring.width,
      y: (note.top + note.height / 2 - (ring.top + ring.height / 2)) / ring.height,
    };
  });

  await page.evaluate(() => cronoStart());
  const runningPosition = await page.evaluate(() => {
    const ring = document.querySelector('#cronoStageRun .crono-run-progress-svg').getBoundingClientRect();
    const note = document.querySelector('#cronoStageRun .crono-tomorrow-note-btn').getBoundingClientRect();
    return {
      x: (note.left + note.width / 2 - (ring.left + ring.width / 2)) / ring.width,
      y: (note.top + note.height / 2 - (ring.top + ring.height / 2)) / ring.height,
    };
  });
  expect(Math.abs(idlePosition.x - runningPosition.x)).toBeLessThanOrEqual(0.02);
  expect(Math.abs(idlePosition.y - runningPosition.y)).toBeLessThanOrEqual(0.02);
  await expect(page.locator('#cronoRunDrawer .crono-run-drawer-tab')).toHaveCount(2);
  await expect(page.locator('#cronoRunDrawer .crono-run-drawer-tab[data-tab="tareas"]')).toContainText('Tareas');
  await expect(page.locator('#cronoRunDrawer .crono-run-drawer-tab[data-action="pase"]')).toHaveText('Pase +');

  await page.locator('#cronoStageRun .crono-tomorrow-note-btn').click();
  await expect(page.locator('#modalCronoNote')).toHaveClass(/visible/);
  await expect(page.locator('#cronoNoteContext')).toContainText('Bach · Preludio');
  await page.locator('#cronoNoteInput').fill('Revisar mañana la digitación de la coda y probar menos pedal.');
  await page.locator('#modalCronoNote').getByRole('button', { name: 'Guardar', exact: true }).click();

  const saved = await page.evaluate(() => {
    const task = cronoTasks().find(item => item.source === 'tomorrow-note');
    return task && {
      text: task.text,
      obraId: task.obraId,
      obraName: task.obraName,
      tomorrow: task.tomorrow,
      dueDate: task.dueDate,
      expectedDueDate: habitKeyAt(habitDayKey(), 1),
      runId: task.runId,
    };
  });
  expect(saved).toEqual(expect.objectContaining({
    text: 'Revisar mañana la digitación de la coda y probar menos pedal.',
    obraId: 'obra_1',
    obraName: 'Bach · Preludio',
    tomorrow: true,
    dueDate: saved.expectedDueDate,
  }));
  expect(saved.runId).toBeTruthy();

  const taskRow = page.locator('#cronoTasksPanel .crono-task-row.is-tomorrow-note');
  await expect(taskRow.locator('.crono-task-work-name')).toHaveText('Bach · Preludio');
  await expect(taskRow.locator('.crono-task-note-preview')).toContainText('Revisar mañana la digitación');
  await expect(taskRow.locator('.crono-task-due-tag')).toHaveText('Mañana');
});

test('records only concentration and discomfort across timer layouts', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  await page.evaluate(() => showView('cronometro'));

  const monitor = page.locator('.crono-concentration-monitor');
  await expect(monitor).toBeVisible();
  await expect(monitor).toContainText('Concentración');
  await page.locator('#cronoMomentNote').fill('Concentrarme en la mano derecha');
  await monitor.getByRole('radio', { name: 'Alta', exact: true }).click();
  await expect(monitor.getByRole('radio', { name: 'Alta', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#cronoMomentNote')).toHaveValue('');

  await page.locator('#cronoMomentNote').fill('Tensión física y pensamiento repetitivo');
  const discomfort = page.locator('#cronoDiscomfortFaces');
  await discomfort.getByRole('radio', { name: 'Medio', exact: true }).click();
  await expect(discomfort.getByRole('radio', { name: 'Medio', exact: true })).toHaveAttribute('aria-checked', 'true');

  const state = await page.evaluate(() => ({
    value: estadoActualVal(),
    lastLabel: ensureEstadoEventos().at(-1)?.label,
    lastNote: ensureEstadoEventos().at(-1)?.note,
    discomfortLabel: ensureMalestarEventos().at(-1)?.label,
    discomfortNote: ensureMalestarEventos().at(-1)?.note,
    impulseCount: ensureImpulsoEventos().length,
    resistanceCount: ensureResistenciaEventos().length,
  }));
  expect(state).toEqual({
    value: 78,
    lastLabel: 'Alta',
    lastNote: 'Concentrarme en la mano derecha',
    discomfortLabel: 'Medio',
    discomfortNote: 'Tensión física y pensamiento repetitivo',
    impulseCount: 0,
    resistanceCount: 0,
  });

  await expect(page.locator('#cronoMomentHistoryList')).toHaveCount(0);
  await expect(page.locator('.crono-moment-history-toggle')).toHaveCount(0);
  const horizontalLayout = await page.evaluate(() => {
    const stage = document.getElementById('cronoStageIdle').getBoundingClientRect();
    const monitorBox = document.querySelector('.crono-moment-monitor').getBoundingClientRect();
    return { stageBottom: stage.bottom, monitorTop: monitorBox.top };
  });
  expect(horizontalLayout.monitorTop).toBeGreaterThanOrEqual(horizontalLayout.stageBottom - 1);

  await page.waitForTimeout(900);
  await expect(monitor.locator('.estado-face.active')).toHaveCount(0);
  await expect(page.locator('#estadoFaces .estado-face.active')).toHaveCount(0);

  await page.setViewportSize({ width: 834, height: 1194 });
  const momentMonitor = page.locator('.crono-moment-monitor');
  await expect(momentMonitor).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-mobile-trigger')).toBeHidden();
  await expect(momentMonitor.locator('.crono-moment-controls')).toBeHidden();
  await expect(momentMonitor.locator('.crono-fluid-panel')).toBeVisible();
  await expect(momentMonitor.locator('.crono-impulse-monitor')).toHaveCount(0);
  await expect(momentMonitor.locator('.crono-resistance-monitor')).toHaveCount(0);
  await expect(momentMonitor.locator('.crono-concentration-monitor')).toBeHidden();
  await expect(momentMonitor.locator('.crono-discomfort-monitor')).toBeHidden();
  await expect(page.locator('.crono-calendar-panel')).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-history-toggle')).toHaveCount(0);
  await expect(momentMonitor.locator('#cronoMomentNote')).toBeHidden();
  await expect(momentMonitor.locator('.crono-moment-history-list')).toHaveCount(0);
  const portraitTabletLayout = await page.evaluate(() => {
    const clock = document.querySelector('#cronoStageIdle .crono-idle-main').getBoundingClientRect();
    const states = document.querySelector('.crono-moment-monitor').getBoundingClientRect();
    const calendar = document.querySelector('.crono-calendar-panel').getBoundingClientRect();
    const tools = document.getElementById('cronoIdleDrawer').getBoundingClientRect();
    return {
      clock: { top: clock.top, right: clock.right, bottom: clock.bottom, height: clock.height },
      states: { top: states.top, left: states.left, bottom: states.bottom, width: states.width, height: states.height },
      calendar: { top: calendar.top, left: calendar.left, bottom: calendar.bottom, height: calendar.height },
      tools: { top: tools.top, right: tools.right, bottom: tools.bottom, width: tools.width, height: tools.height },
    };
  });
  expect(Math.abs(portraitTabletLayout.clock.top - portraitTabletLayout.calendar.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(portraitTabletLayout.clock.height - portraitTabletLayout.calendar.height)).toBeLessThanOrEqual(2);
  expect(portraitTabletLayout.calendar.left).toBeGreaterThanOrEqual(portraitTabletLayout.clock.right - 1);
  expect(portraitTabletLayout.states.top).toBeGreaterThanOrEqual(portraitTabletLayout.clock.bottom - 1);
  expect(Math.abs(portraitTabletLayout.tools.top - portraitTabletLayout.states.top)).toBeLessThanOrEqual(2);
  expect(portraitTabletLayout.states.left).toBeGreaterThanOrEqual(portraitTabletLayout.tools.right - 1);
  expect(Math.abs(portraitTabletLayout.tools.height - portraitTabletLayout.states.height)).toBeLessThanOrEqual(2);
  expect(portraitTabletLayout.tools.width).toBeGreaterThan(portraitTabletLayout.states.width);
  const fixedClock = await page.evaluate(() => {
    const timer = document.querySelector('#cronoStageIdle .crono-idle-main');
    const calendar = document.querySelector('.crono-calendar-panel');
    const ring = document.getElementById('cronoTimerSvg');
    cronoResetInterfaceScale();
    const before = { timer: timer.getBoundingClientRect().height, calendar: calendar.getBoundingClientRect().height, ring: ring.getBoundingClientRect().width };
    cronoSetInterfaceScale(0.1, { persist: false, announce: false });
    const longText = 'Un destello suficientemente largo para comprobar que el texto se adapta al espacio disponible sin cortarse con el tamaño fijo del reloj.';
    cronoSetIdleDestelloText(longText);
    const message = document.getElementById('cronoIdleMessage');
    const result = {
      scale: Number(document.getElementById('view-cronometro').dataset.interfaceScale),
      timer: timer.getBoundingClientRect().height,
      calendar: calendar.getBoundingClientRect().height,
      ring: ring.getBoundingClientRect().width,
      messageFits: message.scrollHeight <= message.clientHeight + 1,
      messageClass: message.className,
    };
    cronoSetIdleDestelloText(_cronoIdlePhrase());
    cronoResetInterfaceScale();
    return { before, result };
  });
  expect(fixedClock.result.scale).toBe(1);
  expect(fixedClock.result.timer).toBe(fixedClock.before.timer);
  expect(fixedClock.result.calendar).toBe(fixedClock.before.calendar);
  expect(fixedClock.result.ring).toBe(fixedClock.before.ring);
  expect(fixedClock.result.messageFits).toBe(true);
  expect(fixedClock.result.messageClass).toContain('size-xlong');
  const tabletFluidBox = await momentMonitor.locator('.crono-fluid-panel').boundingBox();
  const tabletFluidVesselBox = await momentMonitor.locator('#cronoFluidConcentration .crono-fluid-vessel').boundingBox();
  expect(tabletFluidBox.y).toBeGreaterThanOrEqual(0);
  expect(tabletFluidBox.y + tabletFluidBox.height).toBeLessThanOrEqual(1194);
  expect(tabletFluidVesselBox.width).toBeGreaterThanOrEqual(62);
  expect(tabletFluidVesselBox.height).toBeGreaterThanOrEqual(220);
  await expect(momentMonitor.locator('.crono-moment-history')).toBeHidden();

  const immediatePulse = await page.evaluate(() => {
    _pulseRange = 'dia';
    _pulseOffset = -1;
    _pulseDayStartMinute = 9 * 60;
    _pulseDayEndMinute = 14 * 60;
    localStorage.setItem('pulse_day_start', String(_pulseDayStartMinute));
    localStorage.setItem('pulse_day_end', String(_pulseDayEndMinute));
    const oldEnough = new Date(Date.now() - CRONO_FLUID_COOLDOWN_MS - 1000).toISOString();
    const priorConcentration = ensureEstadoEventos().at(-1);
    const priorDiscomfort = ensureMalestarEventos().at(-1);
    if (priorConcentration) priorConcentration.at = oldEnough;
    if (priorDiscomfort) priorDiscomfort.at = oldEnough;
    const before = ensureEstadoEventos().length;
    const discomfortBefore = ensureMalestarEventos().length;
    const firstSaved = cronoFluidCommit('concentration', 67, document.getElementById('cronoFluidConcentration'));
    const latest = ensureEstadoEventos().at(-1);
    const duplicateSaved = cronoFluidCommit('concentration', 72, document.getElementById('cronoFluidConcentration'));
    const editedValue = latest?.value;
    const editedCount = ensureEstadoEventos().length;
    cronoFluidEndEditWindow('concentration');
    const afterWindow = cronoFluidCommit('concentration', 31, document.getElementById('cronoFluidConcentration'));
    const discomfortSaved = cronoFluidCommit('discomfort', 43, document.getElementById('cronoFluidDiscomfort'));
    return {
      before,
      after: ensureEstadoEventos().length,
      discomfortBefore,
      discomfortAfter: ensureMalestarEventos().length,
      firstSaved,
      duplicateSaved,
      editedValue,
      editedCount,
      afterWindow,
      discomfortSaved,
      latestValue: latest?.value,
      latestMinute: new Date(latest?.at).getHours() * 60 + new Date(latest?.at).getMinutes(),
      visibleEnd: _pulseDayEndMinute,
      offset: _pulseOffset,
      savedClass: document.getElementById('cronoFluidConcentration').classList.contains('is-saved'),
      concentrationCooling: document.getElementById('cronoFluidConcentration').getAttribute('aria-disabled'),
      discomfortCooling: document.getElementById('cronoFluidDiscomfort').getAttribute('aria-disabled'),
    };
  });
  expect(immediatePulse.after).toBe(immediatePulse.before + 1);
  expect(immediatePulse.discomfortAfter).toBe(immediatePulse.discomfortBefore + 1);
  expect(immediatePulse.firstSaved).toBe(true);
  expect(immediatePulse.duplicateSaved).toBe(true);
  expect(immediatePulse.editedValue).toBe(72);
  expect(immediatePulse.editedCount).toBe(immediatePulse.after);
  expect(immediatePulse.afterWindow).toBe(false);
  expect(immediatePulse.discomfortSaved).toBe(true);
  expect(immediatePulse.latestValue).toBe(72);
  expect(immediatePulse.visibleEnd).toBeGreaterThanOrEqual(immediatePulse.latestMinute);
  expect(immediatePulse.offset).toBe(0);
  expect(immediatePulse.savedClass).toBe(true);
  expect(immediatePulse.concentrationCooling).toBe('true');
  expect(immediatePulse.discomfortCooling).toBe('true');

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.crono-calendar-panel')).toBeHidden();
  await expect(momentMonitor.locator('.crono-fluid-panel')).toBeHidden();
  const mobileTrigger = momentMonitor.locator('.crono-moment-mobile-trigger');
  await expect(mobileTrigger).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-content')).toBeHidden();
  await mobileTrigger.click();
  await expect(mobileTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(momentMonitor.locator('.crono-moment-content')).toBeVisible();
  await expect(momentMonitor.locator('.crono-fluid-panel')).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-controls')).toBeHidden();
  await expect(momentMonitor.locator('#cronoConcentrationFaces')).toBeHidden();
  await expect(momentMonitor.locator('#cronoDiscomfortFaces')).toBeHidden();
  await expect(momentMonitor.locator('.crono-moment-history')).toBeHidden();
  await expect(momentMonitor.locator('#cronoFluidConcentration')).toHaveAttribute('aria-disabled', 'true');
  await expect(momentMonitor.locator('#cronoFluidDiscomfort')).toHaveAttribute('aria-disabled', 'true');
  await expect(momentMonitor.locator('#cronoImpulseFaces')).toHaveCount(0);
  await expect(momentMonitor.locator('#cronoResistanceFaces')).toHaveCount(0);
  const mobileContentBox = await momentMonitor.locator('.crono-moment-content').boundingBox();
  const mobileFluidVesselBox = await momentMonitor.locator('#cronoFluidConcentration .crono-fluid-vessel').boundingBox();
  expect(mobileContentBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileContentBox.x + mobileContentBox.width).toBeLessThanOrEqual(390);
  expect(mobileContentBox.y).toBeGreaterThanOrEqual(0);
  expect(mobileContentBox.y + mobileContentBox.height).toBeLessThanOrEqual(844);
  expect(mobileFluidVesselBox.width).toBeGreaterThanOrEqual(58);
  expect(mobileFluidVesselBox.height).toBeGreaterThanOrEqual(150);

  await page.evaluate(() => showView('pulse'));
  await expect(page.locator('#pulseDashboard .pulse-card')).toContainText('4 registros');
  await expect(page.locator('#pulseDashboard .pulse-metric')).toHaveText(['Concentración', 'Malestar']);
  await expect(page.locator('#pulseDashboard .pulse-point')).toHaveCount(0);
  const pulseChartBox = await page.locator('#pulseDashboard .pulse-chart').boundingBox();
  expect(pulseChartBox.height).toBeGreaterThan(180);
  expect(pulseChartBox.height).toBeLessThan(240);
  await page.evaluate(() => showView('session'));
  await expect(page.locator('#statsDashboard .pulse-shortcut')).toBeVisible();
  await expect(page.locator('#statsDashboard .pulse-card')).toHaveCount(0);
});

test('keeps running clock actions inside the timer card across pinch zoom levels', async ({ page }) => {
  await prepare(page);
  for (const viewport of [{ width: 1024, height: 768, actionSize: 64 }, { width: 834, height: 1194, actionSize: 54 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      showView('cronometro');
      db.obras[0].minutosExtra = 120;
      db.sesiones = [{
        date: new Date(Date.now() - 30 * 86400000).toISOString(),
        items: [{ obraId: 'obra_1', estudiado: true, tick: 'parcial', minutosReales: 35 }],
      }];
      const select = document.getElementById('cronoObraSelect');
      select.value = 'obra::obra_1';
      cronoUpdateStartBtn();
      cronoStart();
      crono.startTs = Date.now() - 6 * 60000;
      cronoRender();
      const expectedWorkTotal = '2h 41min';
      const phraseCard = document.getElementById('cronoRunDestello');
      phraseCard.className = 'crono-run-destello size-xlong';
      phraseCard.innerHTML = '<span class="crono-run-destello-text">Una repetición consciente conserva el sonido, la dirección y la sensación exacta que quieres encontrar mañana sin añadir tensión innecesaria.</span>';
      phraseCard.style.display = '';
      const rect = selector => {
        const box = document.querySelector(selector)?.getBoundingClientRect();
        return box ? { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height } : null;
      };
      const layouts = [0.5, 1, 1.22].map(scale => {
        cronoSetInterfaceScale(scale, { announce: false });
        const rail = rect('.crono-run-action-rail');
        const display = rect('#cronoDisplay');
        const stage = rect('#cronoStageRun');
        const displayCenter = { x: (display.left + display.right) / 2, y: (display.top + display.bottom) / 2 };
        return {
          scale,
          rail,
          display,
          stage,
          calendar: rect('.crono-calendar-panel'),
          destello: rect('.crono-run-side-destello'),
          stop: rect('#cronoControls .crono-session-rail-main'),
          phrase: rect('#cronoRunDestello'),
          phraseFontSize: parseFloat(getComputedStyle(phraseCard).fontSize),
          phraseClamp: getComputedStyle(phraseCard.querySelector('.crono-run-destello-text')).webkitLineClamp,
          coversDisplayCenter: rail.left <= displayCenter.x && rail.right >= displayCenter.x
            && rail.top <= displayCenter.y && rail.bottom >= displayCenter.y,
        };
      });
      return {
        layouts,
        today: document.getElementById('cronoRunTodayTotal')?.textContent,
        workTotal: document.getElementById('cronoRunWorkTotal')?.textContent,
        workTotalFits: document.getElementById('cronoRunWorkTotal').scrollWidth <= document.getElementById('cronoRunWorkTotal').clientWidth + 1,
        expectedWorkTotal,
        milestoneCount: document.querySelectorAll('#cronoMilestone, #cronoRunMilestone').length,
        stopBadgeCount: document.querySelectorAll('.crono-session-stop-mark').length,
        hasVisibleStopIcon: !!document.querySelector('#cronoControls .crono-session-main-icon rect'),
        hasHoldRing: !!document.querySelector('#cronoControls .crono-session-hold-ring'),
        hasHoldHandlers: document.getElementById('cronoControls')?.innerHTML.includes('cronoSessionButtonPressStart'),
      };
    });
    for (const zoomLayout of layout.layouts) {
      expect(zoomLayout.coversDisplayCenter).toBe(false);
      expect(zoomLayout.stop.top).toBeGreaterThanOrEqual(zoomLayout.destello.bottom - 1);
      expect(zoomLayout.rail.left).toBeGreaterThanOrEqual(zoomLayout.stage.left - 1);
      expect(zoomLayout.rail.right).toBeLessThanOrEqual(zoomLayout.stage.right + 1);
      if (zoomLayout.calendar.width > 0) expect(zoomLayout.rail.right).toBeLessThanOrEqual(zoomLayout.calendar.left + 1);
      expect(zoomLayout.destello.width).toBeGreaterThanOrEqual(viewport.actionSize);
      expect(zoomLayout.stop.width).toBeGreaterThanOrEqual(viewport.actionSize);
      expect(zoomLayout.phrase.left).toBeGreaterThanOrEqual(zoomLayout.stage.left - 1);
      expect(zoomLayout.phrase.right).toBeLessThanOrEqual(zoomLayout.stage.right + 1);
      expect(zoomLayout.phraseFontSize).toBeGreaterThanOrEqual(13);
      expect(zoomLayout.phraseClamp).toBe('4');
    }
    expect(new Set(layout.layouts.map(item => item.phraseFontSize)).size).toBe(1);
    expect(layout.today).toBe('6 min');
    expect(layout.workTotal).toBe(layout.expectedWorkTotal);
    expect(layout.workTotalFits).toBe(true);
    expect(layout.milestoneCount).toBe(0);
    expect(layout.stopBadgeCount).toBe(0);
    expect(layout.hasVisibleStopIcon).toBe(true);
    expect(layout.hasHoldRing).toBe(true);
    expect(layout.hasHoldHandlers).toBe(true);
  }
});

test('allows a short pulse correction without creating a duplicate entry', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    showView('cronometro');
    const control = document.getElementById('cronoFluidConcentration');
    const first = cronoFluidCommit('concentration', 40, control);
    const countAfterFirst = ensureEstadoEventos().length;
    const second = cronoFluidCommit('concentration', 72, control);
    const latest = ensureEstadoEventos().at(-1);
    const countAfterEdit = ensureEstadoEventos().length;
    const editVisible = control.classList.contains('is-edit-window') && !control.hasAttribute('aria-disabled');
    const editSeconds = Number(control.dataset.editSeconds);
    cronoFluidEndEditWindow('concentration');
    const blocked = cronoFluidCommit('concentration', 31, control);
    return {
      first,
      second,
      blocked,
      countAfterFirst,
      countAfterEdit,
      latestValue: latest?.value,
      editVisible,
      editSeconds,
    };
  });
  expect(result.first).toBe(true);
  expect(result.second).toBe(true);
  expect(result.blocked).toBe(false);
  expect(result.countAfterEdit).toBe(result.countAfterFirst);
  expect(result.latestValue).toBe(72);
  expect(result.editVisible).toBe(true);
  expect(result.editSeconds).toBe(30);
});

test('draws one smooth curve across sessions and reserves touch drag for the time trimmer', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    const now = new Date();
    const at = (hour, minute) => {
      const value = new Date(now);
      value.setHours(hour, minute, 0, 0);
      return value;
    };
    db.sessionPlants = [
      {
        id: 'pulse-session-morning', obraId: 'obra_1', startedAt: at(9, 0).toISOString(),
        endedAt: at(10, 0).toISOString(), mins: 60, source: 'app',
      },
      {
        id: 'pulse-session-afternoon', obraId: 'obra_1', startedAt: at(16, 0).toISOString(),
        endedAt: at(17, 0).toISOString(), mins: 60, source: 'app',
      },
    ];
    db.estadoEventos = [
      { id: 'pulse-1', at: at(9, 10).toISOString(), value: 78, label: 'Alta' },
      { id: 'pulse-2', at: at(9, 40).toISOString(), value: 56, label: 'Media' },
      { id: 'pulse-outside-session', at: at(13, 0).toISOString(), value: 96, label: 'Muy alta' },
      { id: 'pulse-3', at: at(16, 10).toISOString(), value: 34, label: 'Baja' },
      { id: 'pulse-4', at: at(16, 40).toISOString(), value: 78, label: 'Alta' },
    ];
    db.malestarEventos = [
      { id: 'distress-night', at: at(2, 30).toISOString(), value: 80, label: 'Alto' },
      { id: 'distress-1', at: at(9, 20).toISOString(), value: 80, label: 'Alto' },
      { id: 'distress-2', at: at(9, 50).toISOString(), value: 40, label: 'Bajo' },
    ];
    db.pulseDeletedIds = [];
    _pulseRange = 'dia';
    _pulseOffset = 0;
    renderPulseDashboard();
  });
  await page.evaluate(() => showView('pulse'));

  await expect(page.locator('.pulse-line')).toHaveCount(2);
  await expect(page.locator('.pulse-axis-x')).toHaveText(['09:00', '12:00', '15:00', '18:00', '21:00', '23:00']);
  await expect(page.locator('.pulse-axis-x', { hasText: '00:00' })).toHaveCount(0);
  await expect(page.locator('.pulse-point')).toHaveCount(0);
  await expect(page.locator('.pulse-axis-y')).toHaveText(['0', '25', '50', '75', '100']);
  const smoothPaths = await page.locator('.pulse-line').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  expect(smoothPaths.every(path => / C[\d.]+,[\d.]+/.test(path || ''))).toBe(true);
  await expect(page.locator('.pulse-gap-line')).toHaveCount(0);
  await expect(page.locator('.pulse-band')).toHaveCount(0);
  await expect(page.locator('.pulse-method')).toContainText('sin marcadores');
  await page.locator('.pulse-record-manager summary').click();
  await expect(page.locator('.pulse-record-manager')).toContainText('78/100');
  const deletePulseButton = page.locator('.pulse-delete-record[data-record-id="pulse-1"]');
  await deletePulseButton.click();
  await expect(deletePulseButton).toHaveText('Confirmar');
  expect(await page.evaluate(() => db.estadoEventos.some(item => item.id === 'pulse-1'))).toBe(true);
  await deletePulseButton.click();
  await expect(page.locator('.pulse-delete-record[data-record-id="pulse-1"]')).toHaveCount(0);
  expect(await page.evaluate(() => ({
    present: db.estadoEventos.some(item => item.id === 'pulse-1'),
    deleted: db.pulseDeletedIds.includes('concentration::pulse-1'),
  }))).toEqual({ present: false, deleted: true });
  const touchGuard = await page.locator('.pulse-trimmer').evaluate(trimmer => {
    let reachedDocument = false;
    const observeStart = () => { reachedDocument = true; };
    document.addEventListener('touchstart', observeStart);
    trimmer.dispatchEvent(new Event('touchstart', { bubbles: true, cancelable: true }));
    document.removeEventListener('touchstart', observeStart);
    const move = new Event('touchmove', { bubbles: true, cancelable: true });
    trimmer.dispatchEvent(move);
    return { touchAction: getComputedStyle(trimmer).touchAction, prevented: move.defaultPrevented, startStopped: !reachedDocument };
  });
  expect(touchGuard).toEqual({ touchAction: 'none', prevented: true, startStopped: true });

  const dragHandleTo = async (selector, ratio) => {
    const track = await page.locator('.pulse-trimmer').boundingBox();
    const handle = await page.locator(selector).boundingBox();
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(track.x + track.width * ratio, track.y + track.height / 2, { steps: 8 });
    await page.mouse.up();
  };
  await dragHandleTo('#pulseWindowStart', .5);
  await dragHandleTo('#pulseWindowEnd', .75);

  await expect(page.locator('#pulseWindowLabel')).toHaveText('12:00–18:00');
  await expect(page.locator('.pulse-axis-x')).toHaveText(['12:00', '14:00', '16:00', '18:00']);
  await expect(page.locator('.pulse-point')).toHaveCount(0);
  await expect(page.locator('.pulse-line')).toHaveCount(1);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'pulse');
  await expect(page.locator('body')).not.toHaveClass(/view-swipe-dragging/);
  expect(await page.evaluate(() => [localStorage.getItem('pulse_day_start'), localStorage.getItem('pulse_day_end')])).toEqual(['720', '1080']);
});

test('keeps large touch iPads in the two-row tablet layout', async ({ browser }) => {
  for (const viewport of [{ width: 1366, height: 1024 }, { width: 1194, height: 834 }]) {
    const context = await browser.newContext({ viewport, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await prepare(page);
    const layout = await page.evaluate(async () => {
      showView('cronometro');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = selector => {
        const element = document.querySelector(selector);
        const box = element.getBoundingClientRect();
        return { top: box.top, bottom: box.bottom, width: box.width, height: box.height };
      };
      return {
        coarse: matchMedia('(pointer: coarse)').matches,
        desktopPointer: matchMedia('(hover: hover) and (pointer: fine)').matches,
        tabletLandscape: matchMedia('(min-width: 900px) and (max-width: 1399px) and (min-height: 820px) and (orientation: landscape) and (min-aspect-ratio: 4/3) and (max-aspect-ratio: 3/2)').matches,
        clock: rect('.crono-idle-main'),
        calendar: rect('.crono-calendar-panel'),
        tasks: rect('.crono-idle-drawer'),
        pulse: rect('.crono-fluid-panel'),
        ring: rect('.crono-idle-display-wrap .crono-run-progress-svg'),
        vessel: rect('.crono-fluid-vessel'),
        start: rect('#cronoStartBtn'),
        oldControls: getComputedStyle(document.querySelector('.crono-moment-controls')).display,
        history: getComputedStyle(document.querySelector('.crono-moment-history')).display,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        innerWidth,
        innerHeight,
      };
    });
    expect(layout.coarse).toBe(true);
    expect(layout.desktopPointer).toBe(false);
    expect(layout.tabletLandscape).toBe(true);
    expect(Math.abs(layout.clock.top - layout.calendar.top)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.clock.height - layout.calendar.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.tasks.top - layout.pulse.top)).toBeLessThanOrEqual(1);
    expect(layout.tasks.width).toBeGreaterThan(layout.pulse.width * 1.8);
    expect(layout.ring.height).toBeLessThanOrEqual(260);
    expect(layout.vessel.width).toBeGreaterThanOrEqual(72);
    expect(layout.vessel.height).toBeGreaterThanOrEqual(210);
    expect(layout.start.bottom).toBeLessThanOrEqual(layout.clock.bottom + 1);
    expect(layout.oldControls).toBe('none');
    expect(layout.history).toBe('none');
    expect(layout.scrollWidth).toBeLessThanOrEqual(layout.innerWidth + 1);
    expect(layout.scrollHeight).toBeLessThanOrEqual(layout.innerHeight + 1);
    await context.close();
  }
});

test('places pulse and calendar at the ends of swipe navigation', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    showView('cronometro');
    showViewFromSwipe('pulse');
    const pulseActive = document.body.getAttribute('data-view');
    showViewFromSwipe('calendario');
    return {
      order: SWIPE_VIEW_ORDER.slice(),
      pulseActive,
      active: document.body.getAttribute('data-view'),
    };
  });
  expect(result).toEqual({
    order: ['pulse', 'session', 'cronometro', 'obras', 'calendario'],
    pulseActive: 'pulse',
    active: 'calendario',
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => {
    showView('obras');
    const target = document.getElementById('view-obras');
    const touch = (x, y) => ({ identifier: 7, target, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    const dispatch = (type, touches, changedTouches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches || touches });
      document.dispatchEvent(event);
    };
    dispatch('touchstart', [touch(340, 360)]);
    dispatch('touchmove', [touch(90, 354)]);
    dispatch('touchend', [], [touch(90, 354)]);
  });
  await page.waitForTimeout(650);
  expect(await page.evaluate(() => document.body.getAttribute('data-view'))).toBe('calendario');
});

test('keeps mobile tasks readable and swipes calendar months', async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await prepare(page);

  const taskLayout = await page.evaluate(async () => {
    db.cronoTasks = [
      ...Array.from({ length: 6 }, (_, index) => ({
        id: 'mobile_personal_task_' + index,
        text: 'Tarea personal numero ' + (index + 1),
        kind: 'personal',
      })),
    ].map(task => ({ ...task, tomorrow: false, done: false, createdAt: new Date().toISOString() }));
    showView('cronometro');
    cronoSetMode('timer');
    cronoSetInterfaceScale(CRONO_INTERFACE_SCALE_MIN_MOBILE, { persist: false, announce: false });
    renderCronoTasks();
    await new Promise(resolve => setTimeout(resolve, 380));
    const rect = element => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const row = rect(document.querySelector('#cronoIdleTasksPanel .personal .crono-task-row'));
    const lanes = Array.from(document.querySelectorAll('#cronoIdleTasksPanel .crono-task-lane')).map(rect);
    const personalList = document.querySelector('#cronoIdleTasksPanel .personal .crono-task-list');
    const ring = rect(document.querySelector('#cronoIdleDisplayWrap .crono-run-progress-svg'));
    const displayElement = document.querySelector('#cronoIdleDisplayWrap .crono-display');
    const display = rect(displayElement);
    const flash = rect(document.querySelector('#cronoStageIdle .crono-quick-destello-btn'));
    const note = rect(document.querySelector('#cronoStageIdle .crono-tomorrow-note-btn'));
    return {
      width: row.width,
      lanes,
      personalColumns: getComputedStyle(personalList).gridTemplateColumns.split(' ').length,
      projectionDisplay: getComputedStyle(document.getElementById('cronoTimerProjection')).display,
      clock: {
        ring,
        display,
        flash,
        note,
        fontSize: parseFloat(getComputedStyle(displayElement).fontSize),
      },
    };
  });
  expect(taskLayout.width).toBeGreaterThanOrEqual(170);
  expect(taskLayout.lanes.every(lane => lane.width >= 200)).toBe(true);
  expect(taskLayout.personalColumns).toBe(1);
  expect(taskLayout.projectionDisplay).toBe('none');
  expect(taskLayout.clock.fontSize).toBeGreaterThan(50);
  expect(taskLayout.clock.fontSize).toBeLessThanOrEqual(70);
  expect(taskLayout.clock.display.left).toBeGreaterThanOrEqual(taskLayout.clock.ring.left - 1);
  expect(taskLayout.clock.display.right).toBeLessThanOrEqual(taskLayout.clock.ring.right + 1);
  expect(taskLayout.clock.flash.left - taskLayout.clock.ring.right).toBeGreaterThanOrEqual(7);
  expect(taskLayout.clock.ring.left - taskLayout.clock.note.right).toBeGreaterThanOrEqual(7);

  const monthSwipe = await page.evaluate(() => {
    showView('calendario');
    switchCalTab('mes', document.getElementById('calTabMes'));
    const panel = document.getElementById('calPanelMes');
    const before = document.getElementById('mesNavLabel').textContent;
    const touch = (x, y) => ({ identifier: 12, target: panel, clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y });
    const dispatch = (type, touches, changedTouches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      Object.defineProperty(event, 'changedTouches', { value: changedTouches || touches });
      panel.dispatchEvent(event);
    };
    dispatch('touchstart', [touch(330, 430)]);
    dispatch('touchmove', [touch(80, 430)]);
    dispatch('touchend', [], [touch(80, 430)]);
    return {
      before,
      after: document.getElementById('mesNavLabel').textContent,
      view: document.body.getAttribute('data-view'),
    };
  });
  expect(monthSwipe.after).not.toBe(monthSwipe.before);
  expect(monthSwipe.view).toBe('calendario');
});

test('advances free timer progress to a 120 minute maximum and enlarges mode labels', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  const metrics = await page.evaluate(() => {
    showView('cronometro');
    cronoSetMode('stopwatch');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoUpdateStartBtn();
    cronoStart();
    const arc = document.getElementById('cronoRunProgressArc');
    crono.startTs = Date.now() - 60 * 60 * 1000;
    cronoUpdateTimerProgress();
    const halfway = parseFloat(arc.getAttribute('stroke-dashoffset'));
    crono.startTs = Date.now() - 180 * 60 * 1000;
    cronoUpdateTimerProgress();
    const capped = parseFloat(arc.getAttribute('stroke-dashoffset'));
    cronoReset();
    cronoRender();
    const mode = document.querySelector('.crono-mode-opt[data-mode="timer"]');
    const modeStyle = getComputedStyle(mode);
    return {
      halfway,
      capped,
      expectedHalfway: CRONO_RUN_PROGRESS_CIRC / 2,
      fontSize: parseFloat(modeStyle.fontSize),
      minHeight: mode.getBoundingClientRect().height,
      columns: getComputedStyle(document.getElementById('cronoModeToggle')).gridTemplateColumns.split(' ').length,
      controlsInMain: !!document.querySelector('.crono-idle-main > .crono-idle-controls'),
    };
  });

  expect(Math.abs(metrics.halfway - metrics.expectedHalfway)).toBeLessThan(2);
  expect(metrics.capped).toBeLessThanOrEqual(0.01);
  expect(metrics.fontSize).toBeGreaterThanOrEqual(13);
  expect(metrics.minHeight).toBeGreaterThanOrEqual(44);
  expect(metrics.columns).toBe(2);
  expect(metrics.controlsInMain).toBe(true);
});

test('finishes a stale free stopwatch at exactly 120 minutes', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    showView('cronometro');
    db.sessionPlants = [];
    crono.state = 'running';
    crono.mode = 'stopwatch';
    crono.runId = 'stale-free-run';
    crono.isRest = false;
    crono.obraId = 'obra_1';
    crono.movId = null;
    crono.displayName = 'Bach · Preludio';
    crono.startTs = Date.now() - 3 * 24 * 60 * 60_000;
    crono.pausedMs = 0;
    crono.pauseStartTs = 0;
    crono.targetMinutes = null;
    crono.targetDurationMs = null;
    crono.notificationLastMilestoneMinutes = 105;
    cronoHandleLifecycleResume();
    await new Promise(resolve => setTimeout(resolve, 80));
    const saved = db.sessionPlants.find(item => item.runId === 'stale-free-run');
    return {
      state: crono.state,
      mins: saved && saved.mins,
      spanMinutes: saved && Math.round((Date.parse(saved.endedAt) - Date.parse(saved.startedAt)) / 60_000),
    };
  });

  expect(result).toEqual({ state: 'idle', mins: 120, spanMinutes: 120 });
});

test('retires until-time mode without breaking an active legacy timer', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const base = {
      mode: 'until', timerMinutes: 25, untilTime: '20:00', targetMinutes: null,
      targetDurationMs: null, runId: null, isRest: false, obraId: null, movId: null,
      displayName: '', subName: '', color: null, startTs: 0, pausedMs: 0, pauseStartTs: 0,
    };
    localStorage.setItem('pianoCrono_v2', JSON.stringify(Object.assign({}, base, { state: 'idle' })));
    crono.mode = 'stopwatch';
    const idleRestored = cronoLoadState();
    const idleMode = crono.mode;

    localStorage.setItem('pianoCrono_v2', JSON.stringify(Object.assign({}, base, {
      state: 'running', runId: 'legacy-until', obraId: 'obra_1', displayName: 'Bach',
      startTs: Date.now() - 5 * 60000, targetMinutes: 60, targetDurationMs: 60 * 60000,
    })));
    crono.mode = 'stopwatch';
    const activeRestored = cronoLoadState();
    const activeMode = crono.mode;
    cronoReset();
    return {
      idleRestored, idleMode, activeRestored, activeMode, modeAfterReset: crono.mode,
      optionCount: document.querySelectorAll('#cronoModeToggle .crono-mode-opt').length,
      hasUntilOption: !!document.querySelector('#cronoModeToggle [data-mode="until"]'),
    };
  });

  expect(result).toEqual({
    idleRestored: false,
    idleMode: 'timer',
    activeRestored: true,
    activeMode: 'until',
    modeAfterReset: 'timer',
    optionCount: 2,
    hasUntilOption: false,
  });
});

test('deduplicates background timer and stopwatch notifications', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async () => {
    const sent = [];
    cronoShowSystemNotification = event => sent.push(event);
    crono.state = 'running';
    crono.runId = 'notification-e2e';
    crono.obraId = 'obra_1';
    crono.displayName = 'Bach · Preludio';
    crono.isRest = false;
    crono.targetMinutes = null;
    crono.targetDurationMs = null;
    crono.notificationFiveMinuteSent = false;
    crono.notificationTimerMinutesSent = [];
    crono.notificationLastMilestoneMinutes = 0;

    cronoCheckSessionNotifications(46 * 60_000, true);
    cronoCheckSessionNotifications(46 * 60_000, true);

    crono.targetMinutes = 25;
    crono.targetDurationMs = 25 * 60_000;
    crono.notificationFiveMinuteSent = false;
    crono.notificationTimerMinutesSent = [];
    crono.notificationLastMilestoneMinutes = 0;
    cronoCheckSessionNotifications(21 * 60_000, false);
    const beforeBackground = {
      sent: sent.length,
      marked: crono.notificationTimerMinutesSent.slice(),
    };
    cronoCheckSessionNotifications(21 * 60_000, true);
    cronoCheckSessionNotifications(21 * 60_000, true);
    for (const elapsedMinutes of [22, 23, 24]) {
      cronoCheckSessionNotifications(elapsedMinutes * 60_000, true);
      cronoCheckSessionNotifications(elapsedMinutes * 60_000, true);
    }

    const saved = JSON.parse(localStorage.getItem(CRONO_STORAGE_KEY));
    cronoReset();
    return {
      sent,
      fiveMinuteSent: saved.notificationFiveMinuteSent,
      timerMinutesSent: saved.notificationTimerMinutesSent,
      lastMilestoneMinutes: saved.notificationLastMilestoneMinutes,
      beforeBackground,
    };
  });

  expect(result.sent).toEqual([
    { kind: 'stopwatch-milestone', milestoneMinutes: 45 },
    { kind: 'timer-countdown', remainingMs: 4 * 60_000, warningMinutes: 4 },
    { kind: 'timer-countdown', remainingMs: 3 * 60_000, warningMinutes: 3 },
    { kind: 'timer-countdown', remainingMs: 2 * 60_000, warningMinutes: 2 },
    { kind: 'timer-countdown', remainingMs: 1 * 60_000, warningMinutes: 1 },
  ]);
  expect(result.beforeBackground).toEqual({ sent: 1, marked: [] });
  expect(result.fiveMinuteSent).toBe(true);
  expect(result.timerMinutesSent).toEqual([5, 4, 3, 2, 1]);
  expect(result.lastMilestoneMinutes).toBe(0);
});

test('keeps the idle and running timer in the same iPad composition', async ({ browser }) => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 834, height: 1194 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);

    const layout = await page.evaluate(async () => {
      showView('cronometro');
      db.obras[0].color = 'ocean';
      cronoSetMode('timer');
      cronoSetTimerPreset(25);
      const select = document.getElementById('cronoObraSelect');
      select.value = 'obra::obra_1';
      cronoSetObservation('Coda limpia, pulso estable');
      cronoUpdateStartBtn();
      cronoRender();
      await new Promise(resolve => setTimeout(resolve, 600));

      const rect = element => {
        const box = element.getBoundingClientRect();
        return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const idle = {
        main: rect(document.getElementById('cronoStageIdle').querySelector('.crono-idle-main')),
        drawer: rect(document.getElementById('cronoIdleDrawer')),
        ring: rect(document.getElementById('cronoTimerSvg')),
        quickDestello: rect(document.querySelector('#cronoStageIdle .crono-quick-destello-btn')),
        trophy: rect(document.querySelector('[data-habit-slot="idle"] .crono-habit-trophy')),
        destello: rect(document.getElementById('cronoIdleMessage')),
        start: rect(document.getElementById('cronoStartBtn')),
        presetCount: document.querySelectorAll('#cronoDurationPresets button').length,
        tabs: [...document.querySelectorAll('#cronoIdleDrawer .crono-run-drawer-tab')].map(button => button.dataset.tab || button.dataset.action),
        objectiveRemoved: !document.getElementById('cronoIdleObjective') && !document.getElementById('cronoIdleObjectiveText'),
        display: document.getElementById('cronoTimerText').textContent,
        arcColor: getComputedStyle(document.getElementById('cronoTimerArc')).stroke,
        handleColor: getComputedStyle(document.getElementById('cronoTimerHandle')).fill,
        usesRunningDisplay: document.getElementById('cronoTimerText').classList.contains('crono-display')
          && document.getElementById('cronoTimerSvg').classList.contains('crono-run-progress-svg'),
        garden: getComputedStyle(document.getElementById('cronoGarden')).display,
        activeTab: document.getElementById('cronoIdleDrawer').dataset.tab,
      };

      cronoStart();
      const running = {
        main: rect(document.getElementById('cronoStageRun')),
        drawer: rect(document.getElementById('cronoRunDrawer')),
        ring: rect(document.querySelector('#cronoStageRun .crono-run-progress-svg')),
        quickDestello: rect(document.querySelector('#cronoStageRun .crono-quick-destello-btn')),
        trophy: rect(document.querySelector('[data-habit-slot="running"] .crono-habit-trophy')),
        controls: rect(document.getElementById('cronoControls')),
        controlInsideClock: document.getElementById('cronoStageRun').contains(document.getElementById('cronoControls')),
        modeSelectorVisible: getComputedStyle(document.getElementById('cronoModeToggle')).display !== 'none'
          && document.getElementById('cronoStageIdle').style.display !== 'none',
        dailyTotalVisible: getComputedStyle(document.getElementById('cronoRunTodayTotal')).display !== 'none',
        arcColor: getComputedStyle(document.getElementById('cronoRunProgressArc')).stroke,
        handleColor: getComputedStyle(document.getElementById('cronoRunProgressHandle')).fill,
        tabs: [...document.querySelectorAll('#cronoRunDrawer .crono-run-drawer-tab')].map(button => button.dataset.tab || button.dataset.action),
        objectiveRemoved: !document.getElementById('cronoRunObjective') && !document.getElementById('cronoRunObjectiveText'),
        activeTab: document.getElementById('cronoRunDrawer').dataset.tab,
      };
      return {
        portrait: matchMedia('(orientation: portrait)').matches,
        fitsWidth: document.documentElement.scrollWidth <= innerWidth + 1,
        idle,
        running,
      };
    });

    expect(layout.fitsWidth).toBe(true);
    expect(layout.idle.tabs).toEqual(['tareas', 'memoria', 'metronomo', 'pase']);
    expect(layout.running.tabs).toEqual(layout.idle.tabs);
    expect(layout.idle.activeTab).toBe('tareas');
    expect(layout.running.activeTab).toBe('tareas');
    expect(layout.idle.presetCount).toBe(0);
    expect(layout.idle.destello.top - layout.idle.ring.bottom).toBeGreaterThanOrEqual(8);
    expect(layout.idle.start.bottom).toBeLessThanOrEqual(layout.idle.main.bottom + 1);
    expect(layout.idle.objectiveRemoved).toBe(true);
    expect(layout.idle.arcColor).toBe(layout.idle.handleColor);
    expect(layout.running.arcColor).toBe(layout.running.handleColor);
    expect(layout.running.arcColor).toBe(layout.idle.arcColor);
    expect(layout.running.objectiveRemoved).toBe(true);
    expect(layout.idle.display).toBe('25:00');
    expect(layout.idle.usesRunningDisplay).toBe(true);
    expect(layout.idle.garden).toBe('none');
    expect(Math.abs(layout.idle.ring.width - layout.running.ring.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.idle.trophy.width - layout.running.trophy.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.idle.trophy.height - layout.running.trophy.height)).toBeLessThanOrEqual(1);
    expect(layout.running.controlInsideClock).toBe(true);
    expect(layout.running.modeSelectorVisible).toBe(false);
    expect(layout.running.dailyTotalVisible).toBe(true);

    if (layout.portrait) {
      expect(layout.idle.drawer.top).toBeGreaterThanOrEqual(layout.idle.main.bottom - 1);
      expect(layout.running.drawer.top).toBeGreaterThanOrEqual(layout.running.main.bottom - 1);
    } else {
      expect(Math.abs(layout.idle.main.left - layout.running.main.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(layout.idle.drawer.left - layout.running.drawer.left)).toBeLessThanOrEqual(2);
      expect(Math.abs(layout.idle.main.height - layout.running.main.height)).toBeLessThanOrEqual(2);
      expect(Math.abs(layout.idle.drawer.height - layout.running.drawer.height)).toBeLessThanOrEqual(2);
    }
    await context.close();
  }
});

test('keeps Destellos in the same clock position before and during a session', async ({ browser }) => {
  for (const viewport of [{ width: 390, height: 844 }, { width: 834, height: 1194 }, { width: 1024, height: 768 }]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);

    const layout = await page.evaluate(() => {
      showView('cronometro');
      cronoSetMode('timer');
      cronoSetTimerPreset(25);
      const select = document.getElementById('cronoObraSelect');
      select.value = 'obra::obra_1';
      cronoUpdateStartBtn();
      cronoRender();
      cronoSetInterfaceScale(1, { persist: false, announce: false });

      const ringSize = parseFloat(getComputedStyle(document.getElementById('view-cronometro')).getPropertyValue('--crono-interface-ring-size'));
      const relativePosition = (wrap, button) => {
        const parent = wrap.getBoundingClientRect();
        const child = button.getBoundingClientRect();
        const ringTop = parent.top + ((parent.height - ringSize) / 2);
        const ringRight = parent.left + ((parent.width + ringSize) / 2);
        return {
          right: ringRight - ((child.left + child.right) / 2),
          yRatio: (((child.top + child.bottom) / 2) - ringTop) / ringSize,
        };
      };
      const idle = relativePosition(
        document.getElementById('cronoIdleDisplayWrap'),
        document.querySelector('#cronoStageIdle .crono-quick-destello-btn')
      );
      cronoStart();
      const running = relativePosition(
        document.getElementById('cronoDisplayWrap'),
        document.querySelector('#cronoStageRun .crono-quick-destello-btn')
      );
      return { idle, running };
    });

    expect(Math.abs(layout.idle.right - layout.running.right), JSON.stringify(viewport)).toBeLessThanOrEqual(2);
    expect(Math.abs(layout.idle.yRatio - layout.running.yRatio), JSON.stringify({ viewport, layout })).toBeLessThanOrEqual(0.01);
    await context.close();
  }
});

test('keeps a fixed clock size regardless of legacy zoom requests', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  const result = await page.evaluate(async () => {
    db.cronoTasks = [{
      id: 'dense_mobile_task',
      text: 'Repasar la coda',
      kind: 'piano',
      tomorrow: false,
      done: false,
      createdAt: new Date().toISOString(),
    }];
    showView('cronometro');
    renderCronoTasks();
    const rect = element => element.getBoundingClientRect();
    const main = document.querySelector('.crono-idle-main');
    const drawer = document.getElementById('cronoIdleDrawer');
    const ring = document.getElementById('cronoTimerSvg');
    const view = document.getElementById('view-cronometro');
    const before = { main: rect(main).width, drawer: rect(drawer).width, ring: rect(ring).width };
    cronoSetInterfaceScale(0.84, { persist: false, announce: false });
    const compactClock = { main: rect(main).width, drawer: rect(drawer).width, ring: rect(ring).width };
    cronoSetInterfaceScale(1.18, { persist: true, announce: false });
    const largeClock = { main: rect(main).width, drawer: rect(drawer).width, ring: rect(ring).width };
    cronoAnimateInterfaceScale(0.9, { persist: true, announce: false });
    const animated = {
      scale: Number(view.dataset.interfaceScale),
      saved: Number(localStorage.getItem(CRONO_INTERFACE_SCALE_KEY) || 0),
    };
    cronoResetInterfaceScale();
    return {
      before,
      compactClock,
      largeClock,
      animated,
      scale: view.dataset.interfaceScale,
      hasZoomIndicator: !!document.getElementById('cronoInterfaceZoomIndicator'),
    };
  });

  expect(result.compactClock).toEqual(result.before);
  expect(result.largeClock).toEqual(result.before);
  expect(result.animated.scale).toBe(1);
  expect(result.animated.saved).toBe(0);
  expect(result.scale).toBe('1');
  expect(result.hasZoomIndicator).toBe(false);
});

test('keeps a compact mobile task drawer with a fixed clock', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const result = await page.evaluate(async () => {
    db.cronoTasks = [{
      id: 'dense_mobile_task',
      text: 'Repasar la coda',
      kind: 'piano',
      tomorrow: false,
      done: false,
      createdAt: new Date().toISOString(),
    }];
    showView('cronometro');
    renderCronoTasks();
    const ring = document.getElementById('cronoTimerSvg');
    const drawer = document.getElementById('cronoIdleDrawer');
    const before = { ring: ring.getBoundingClientRect().width, drawer: drawer.getBoundingClientRect().height };
    cronoSetInterfaceScale(0.84, { persist: false, announce: false });
    const after = { ring: ring.getBoundingClientRect().width, drawer: drawer.getBoundingClientRect().height };
    return {
      before,
      after,
      tabFont: parseFloat(getComputedStyle(document.querySelector('#cronoIdleDrawer .crono-run-drawer-tab')).fontSize),
      taskFont: parseFloat(getComputedStyle(document.querySelector('.crono-task-lane .crono-task-text')).fontSize),
    };
  });

  expect(result.after.ring).toBe(result.before.ring);
  expect(result.after.drawer).toBe(result.before.drawer);
  expect(result.tabFont).toBeLessThanOrEqual(11);
  expect(result.taskFont).toBeLessThanOrEqual(12);
});

test('uses a complete two-column timer layout on landscape phones', async ({ browser }) => {
  for (const viewport of [
    { width: 740, height: 360 },
    { width: 844, height: 390 },
    { width: 932, height: 430 },
    { width: 1024, height: 576 },
  ]) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await prepare(page);
    const layout = await page.evaluate(async () => {
      showView('cronometro');
      const rect = element => {
        const box = element.getBoundingClientRect();
        return { top: box.top, left: box.left, right: box.right, bottom: box.bottom, width: box.width, height: box.height };
      };
      const inside = box => box.top >= -1 && box.left >= -1 && box.right <= innerWidth + 1 && box.bottom <= innerHeight + 1;
      const idle = {
        main: rect(document.querySelector('.crono-idle-main')),
        drawer: rect(document.getElementById('cronoIdleDrawer')),
        ring: rect(document.getElementById('cronoTimerSvg')),
      };
      const select = document.getElementById('cronoObraSelect');
      select.value = 'obra::obra_1';
      cronoUpdateStartBtn();
      cronoStart();
      const running = {
        main: rect(document.getElementById('cronoStageRun')),
        drawer: rect(document.getElementById('cronoRunDrawer')),
        ring: rect(document.querySelector('#cronoStageRun .crono-run-progress-svg')),
        tabs: rect(document.querySelector('#cronoRunDrawer .crono-run-drawer-tabs')),
        panels: rect(document.querySelector('#cronoRunDrawer .crono-run-drawer-panels')),
        controls: rect(document.getElementById('cronoControls')),
      };
      cronoSetInterfaceScale(1.18, { persist: false, announce: false });
      await new Promise(resolve => setTimeout(resolve, 260));
      const zoomed = {
        main: rect(document.getElementById('cronoStageRun')),
        drawer: rect(document.getElementById('cronoRunDrawer')),
      };
      cronoResetInterfaceScale();
      return {
        idle,
        running,
        zoomed,
        idleFits: inside(idle.main) && inside(idle.drawer) && inside(idle.ring),
        runningFits: inside(running.main) && inside(running.drawer) && inside(running.ring) && inside(running.controls),
        zoomedFits: inside(zoomed.main) && inside(zoomed.drawer),
        documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
      };
    });

    expect(layout.documentFits).toBe(true);
    expect(layout.idleFits).toBe(true);
    expect(layout.runningFits).toBe(true);
    expect(layout.zoomedFits).toBe(true);
    expect(layout.idle.drawer.left).toBeGreaterThanOrEqual(layout.idle.main.right);
    expect(layout.running.drawer.left).toBeGreaterThanOrEqual(layout.running.main.right);
    expect(layout.running.panels.top).toBeGreaterThanOrEqual(layout.running.tabs.bottom - 1);
    expect(layout.running.controls.top).toBeGreaterThanOrEqual(layout.running.main.top - 1);
    expect(layout.running.controls.bottom).toBeLessThanOrEqual(layout.running.main.bottom + 1);
    await context.close();
  }
});

test('runs one persistent metronome from idle and active timer layouts', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => showView('cronometro'));

  await page.locator('#cronoIdleDrawer .crono-metronome-tab').click();
  await expect(page.locator('#cronoIdleDrawer [data-panel="metronomo"]')).toHaveClass(/active/);
  await expect(page.locator('#cronoIdleDrawer .crono-metronome-tempo strong')).toHaveText('80');

  await page.locator('#cronoIdleDrawer .crono-metronome-step-right button').last().click();
  await expect(page.locator('#cronoIdleDrawer .crono-metronome-tempo strong')).toHaveText('85');
  const firstBeat = page.locator('#cronoIdleDrawer .crono-metronome-beat').first();
  await expect(firstBeat).toHaveClass(/is-accent/);
  await firstBeat.click();
  await expect(firstBeat).toHaveClass(/is-normal/);
  await firstBeat.click();
  await expect(firstBeat).toHaveClass(/is-mute/);
  await firstBeat.click();
  await expect(firstBeat).toHaveClass(/is-accent/);
  expect(await page.evaluate(() => __metronomeDebug.getState())).toMatchObject({
    bpm: 85,
    beatsPerBar: 4,
    pattern: ['accent', 'normal', 'normal', 'normal'],
  });

  await page.locator('#cronoIdleDrawer .crono-metronome-count-btn[aria-label="Añadir un pulso"]').click();
  expect(await page.locator('#cronoIdleDrawer .crono-metronome-beat').count()).toBe(5);
  await page.locator('#cronoIdleDrawer .crono-metronome-count-btn[aria-label="Quitar un pulso"]').click();
  expect(await page.locator('#cronoIdleDrawer .crono-metronome-beat').count()).toBe(4);
  await page.evaluate(() => metronomeSetBeats(16));
  expect(await page.locator('#cronoIdleDrawer .crono-metronome-beat').count()).toBe(16);
  await expect(page.locator('#cronoIdleDrawer .crono-metronome-count-btn[aria-label="Añadir un pulso"]')).toBeDisabled();
  const maxPatternLayout = await page.evaluate(() => {
    const beats = document.querySelector('#cronoIdleDrawer .crono-metronome-beats');
    const dots = [...document.querySelectorAll('#cronoIdleDrawer .crono-metronome-beat')];
    const beatBox = beats.getBoundingClientRect();
    const dotBox = dots[0].getBoundingClientRect();
    return {
      round: Math.abs(dotBox.width - dotBox.height) < 1,
      rows: new Set(dots.map(dot => Math.round(dot.getBoundingClientRect().top))).size,
      inside: dots.every(dot => {
        const box = dot.getBoundingClientRect();
        return box.left >= beatBox.left - 1 && box.right <= beatBox.right + 1;
      }),
      documentFits: document.documentElement.scrollWidth <= innerWidth + 1,
    };
  });
  expect(maxPatternLayout).toMatchObject({ round: true, rows: 2, inside: true, documentFits: true });

  await page.locator('#cronoIdleDrawer .crono-metronome-play').click();
  expect(await page.evaluate(() => __metronomeDebug.getState().playing)).toBe(true);

  await page.evaluate(() => {
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoUpdateStartBtn();
    cronoStart();
    cronoSetRunDrawerTab('metronomo');
  });
  await expect(page.locator('#cronoRunDrawer [data-panel="metronomo"]')).toHaveClass(/active/);
  await expect(page.locator('#cronoRunDrawer .crono-metronome-tempo strong')).toHaveText('85');
  expect(await page.evaluate(() => __metronomeDebug.getState())).toMatchObject({ bpm: 85, beatsPerBar: 16, playing: true });

  await page.locator('#cronoRunDrawer .crono-metronome-play').click();
  expect(await page.evaluate(() => __metronomeDebug.getState().playing)).toBe(false);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('alberto_metronome_v1')))).toMatchObject({ bpm: 85, beatsPerBar: 16 });
});

test('reviews work-specific memory cards before and during a timed session', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    cronoUpdateStartBtn();
    cronoSetIdleDrawerTab('memoria');
  });

  await expect(page.locator('#cronoIdleDrawer [data-panel="memoria"]')).toHaveClass(/active/);
  await expect(page.locator('#cronoIdleDrawer .memory-empty-state')).toContainText('Aún no hay tarjetas');
  await page.locator('#cronoIdleDrawer .memory-empty-state button').click();
  await page.locator('#memoryCardLabel').fill('81-88');
  await page.locator('#memoryCardSaveBtn').click();
  await page.locator('#memoryCardLabel').fill('Desarrollo');
  await page.locator('#memoryCardSaveBtn').click();
  await expect(page.locator('#memoryManagerList .memory-manager-row')).toHaveCount(2);
  await page.locator('.memory-manager-close').click();

  const idleMemory = page.locator('#cronoIdleDrawer [data-panel="memoria"]');
  await expect(idleMemory.locator('.memory-flashcard')).toContainText('Compases 81–88');
  await expect(page.locator('[data-memory-count="idle"]')).toHaveText('2');
  await idleMemory.locator('.memory-rating-row .is-good').click();
  await expect(idleMemory.locator('.memory-flashcard')).toContainText('Desarrollo');

  await page.evaluate(() => cronoStart());
  await page.evaluate(() => cronoSetRunDrawerTab('memoria'));
  const runningMemory = page.locator('#cronoRunDrawer [data-panel="memoria"]');
  await expect(runningMemory).toHaveClass(/active/);
  await expect(runningMemory.locator('.memory-flashcard')).toContainText('Desarrollo');
  await runningMemory.locator('.memory-rating-row .is-hard').click();
  await expect(runningMemory.locator('.memory-finished')).toContainText('Todo al día');

  const cards = await page.evaluate(() => db.memoryCards.map(card => ({ label: card.label, intervalDays: card.intervalDays, reviews: card.reviews.length })));
  expect(cards).toEqual([
    { label: 'Compases 81–88', intervalDays: 4, reviews: 1 },
    { label: 'Desarrollo', intervalDays: 2, reviews: 1 },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
