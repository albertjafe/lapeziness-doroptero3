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
      const stats = document.getElementById('view-historial');
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
