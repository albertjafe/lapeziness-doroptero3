import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'obra_1', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
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

  for (const view of ['pulse', 'session', 'cronometro', 'obras', 'calendario', 'historial', 'ajustes']) {
    await page.evaluate(name => { if (typeof showView !== 'function') throw new Error('showView no disponible'); showView(name); }, view);
    await expect(page.locator('#view-' + view)).toHaveClass(/active/);
  }
  expect(errors).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('piano_auto_creds'))).toBeNull();
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
    expect(state.navButtons).toHaveLength(4);
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
      runTabs: [...document.querySelectorAll('#cronoRunDrawer .crono-run-drawer-tab')].map(button => button.dataset.tab),
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
  expect(state.runTabs).toEqual(['pasajes', 'nota', 'tareas', 'pase']);
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
      const drawerButton = document.querySelector('#cronoControls .crono-session-drawer-main');
      const drawerPanels = document.querySelector('#cronoRunDrawer .crono-run-drawer-panels').getBoundingClientRect();
      const drawerButtonBox = drawerButton?.getBoundingClientRect();
      return {
        portrait: matchMedia('(orientation: portrait)').matches,
        stage: { top: stage.top, right: stage.right, bottom: stage.bottom },
        drawer: { top: drawer.top, left: drawer.left, bottom: drawer.bottom },
        controlsBottom: controls.bottom,
        viewportHeight: innerHeight,
        fitsWidth: document.documentElement.scrollWidth <= innerWidth + 1,
        objectiveRemoved: !document.getElementById('cronoRunObjective') && !document.getElementById('cronoRunObjectiveText'),
        observation: document.getElementById('cronoRunObservation').value,
        passage: document.querySelector('.crono-focus-pasaje-copy strong')?.textContent,
        displayRatio: displayTextWidth / ring.width,
        circleIsButton: document.getElementById('cronoDisplayWrap').hasAttribute('role'),
        hasSeparateControl: !!drawerButton,
        controlBelowTools: !!drawerButtonBox && drawerButtonBox.top >= drawerPanels.bottom - 1,
      };
    });

    expect(layout.fitsWidth).toBe(true);
    expect(layout.objectiveRemoved).toBe(true);
    expect(layout.observation).toBe('Coda limpia, pulso estable');
    expect(layout.passage).toBe('Coda · cc. 200–208');
    expect(layout.displayRatio).toBeLessThanOrEqual(0.69);
    expect(layout.circleIsButton).toBe(false);
    expect(layout.hasSeparateControl).toBe(true);
    expect(layout.controlBelowTools).toBe(true);
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

test('cancels or confirms a valid timer before saving and keeps one-tap solidity', async ({ page }) => {
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

  const stable = modal.locator('.hecho-solidez-options button[data-value="65"]');
  await stable.click();
  await expect(stable).toHaveAttribute('aria-checked', 'true');
  await modal.getByRole('button', { name: 'Hecho' }).click();
  await expect(modal).not.toHaveClass(/visible/);

  const taskBreak = page.locator('#modalCronoTaskBreak');
  await expect(taskBreak).toHaveClass(/visible/);
  await expect(taskBreak).toContainText('¿Un descanso?');
  await expect(taskBreak).toContainText('Responder el mensaje pendiente');
  await expect(taskBreak.locator('.crono-task-break-item.priority-3')).toContainText('Urgentísima');
  await taskBreak.getByRole('button', { name: /Responder el mensaje pendiente/ }).click();
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
  await idleTasks.locator('.crono-task-compose-trigger').click();
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
  expect(metrics.displayWidth).toBeLessThanOrEqual(metrics.ringWidth * 0.69);
  expect(metrics.destelloFits).toBe(true);
  expect(metrics.destelloOverflow).toBe('visible');
  expect(['none', 'unset']).toContain(metrics.destelloClamp);
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
  await expect(cards.locator('.crono-pase-score.active')).toHaveCount(0);
  await cards.nth(0).locator('.crono-pase-score').nth(1).click();
  await cards.nth(1).locator('.crono-pase-score').nth(3).click();
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
  await panel.locator('.crono-task-compose-trigger').click();
  await expect(panel.locator('#cronoIdleTaskInput')).toBeFocused();
  await panel.locator('.crono-task-kind-btn.piano').click();
  await panel.locator('.crono-task-tomorrow-btn').click();
  await panel.locator('#cronoIdleTaskInput').fill('Estudiar la coda sin pedal');
  await panel.locator('.crono-task-add-btn').click();
  await expect(panel.locator('.crono-task-lane.piano')).toContainText('Estudiar la coda sin pedal');
  await expect(panel.locator('.crono-task-lane.piano .crono-task-due-tag')).toHaveText('Mañana');

  await panel.locator('.crono-task-compose-trigger').click();
  await panel.locator('.crono-task-kind-btn.personal').click();
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
  expect(personalOnly).toEqual({ reminded: false, tab: 'pasajes' });

  await page.setViewportSize({ width: 834, height: 1194 });
  expect(await page.evaluate(() => getComputedStyle(document.querySelector('.crono-task-columns')).gridTemplateColumns.split(' ').length)).toBe(1);
  await expect(completed.locator('.crono-task-row').first()).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
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

test('records concentration and resisted urges across landscape and portrait timers', async ({ page }) => {
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

  const impulse = page.locator('#cronoImpulseFaces');
  await impulse.getByRole('radio', { name: 'Muy alto', exact: true }).click();
  await expect(impulse.getByRole('radio', { name: 'Muy alto', exact: true })).toHaveAttribute('aria-checked', 'true');

  await page.locator('#cronoMomentNote').fill('Tensión física y pensamiento repetitivo');
  const discomfort = page.locator('#cronoDiscomfortFaces');
  await discomfort.getByRole('radio', { name: 'Medio', exact: true }).click();
  await expect(discomfort.getByRole('radio', { name: 'Medio', exact: true })).toHaveAttribute('aria-checked', 'true');

  await page.locator('#cronoMomentNote').fill('Quería cambiar de tarea');
  const resistance = page.locator('#cronoResistanceFaces');
  await resistance.getByRole('radio', { name: 'Alta', exact: true }).click();
  await expect(resistance.getByRole('radio', { name: 'Alta', exact: true })).toHaveAttribute('aria-checked', 'true');

  const state = await page.evaluate(() => ({
    value: estadoActualVal(),
    lastLabel: ensureEstadoEventos().at(-1)?.label,
    lastNote: ensureEstadoEventos().at(-1)?.note,
    impulseLabel: ensureImpulsoEventos().at(-1)?.label,
    discomfortLabel: ensureMalestarEventos().at(-1)?.label,
    discomfortNote: ensureMalestarEventos().at(-1)?.note,
    resistanceLabel: ensureResistenciaEventos().at(-1)?.label,
    resistanceNote: ensureResistenciaEventos().at(-1)?.note,
  }));
  expect(state).toEqual({
    value: 78,
    lastLabel: 'Alta',
    lastNote: 'Concentrarme en la mano derecha',
    impulseLabel: 'Muy alto',
    discomfortLabel: 'Medio',
    discomfortNote: 'Tensión física y pensamiento repetitivo',
    resistanceLabel: 'Alta',
    resistanceNote: 'Quería cambiar de tarea',
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
  await expect(impulse.locator('.estado-face.active')).toHaveCount(0);
  await expect(page.locator('#estadoFaces .estado-face.active')).toHaveCount(0);

  await page.setViewportSize({ width: 834, height: 1194 });
  const momentMonitor = page.locator('.crono-moment-monitor');
  await expect(momentMonitor).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-mobile-trigger')).toBeHidden();
  await expect(momentMonitor.locator('.crono-moment-controls')).toBeHidden();
  await expect(momentMonitor.locator('.crono-fluid-panel')).toBeVisible();
  await expect(momentMonitor.locator('.crono-impulse-monitor')).toBeHidden();
  await expect(momentMonitor.locator('.crono-resistance-monitor')).toBeHidden();
  await expect(momentMonitor.locator('.crono-concentration-monitor')).toBeHidden();
  await expect(momentMonitor.locator('.crono-discomfort-monitor')).toBeHidden();
  await expect(page.locator('.crono-calendar-panel')).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-history-toggle')).toHaveCount(0);
  await expect(momentMonitor.locator('#cronoMomentNote')).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-history-list')).toHaveCount(0);
  const portraitTabletLayout = await page.evaluate(() => {
    const clock = document.querySelector('#cronoStageIdle .crono-idle-main').getBoundingClientRect();
    const states = document.querySelector('.crono-moment-monitor').getBoundingClientRect();
    const calendar = document.querySelector('.crono-calendar-panel').getBoundingClientRect();
    const tools = document.getElementById('cronoIdleDrawer').getBoundingClientRect();
    return {
      clock: { top: clock.top, right: clock.right, bottom: clock.bottom, height: clock.height },
      states: { top: states.top, left: states.left, bottom: states.bottom },
      calendar: { top: calendar.top, left: calendar.left, bottom: calendar.bottom, height: calendar.height },
      toolsTop: tools.top,
    };
  });
  expect(Math.abs(portraitTabletLayout.clock.top - portraitTabletLayout.calendar.top)).toBeLessThanOrEqual(2);
  expect(Math.abs(portraitTabletLayout.clock.height - portraitTabletLayout.calendar.height)).toBeLessThanOrEqual(2);
  expect(portraitTabletLayout.calendar.left).toBeGreaterThanOrEqual(portraitTabletLayout.clock.right - 1);
  expect(portraitTabletLayout.states.top).toBeGreaterThanOrEqual(portraitTabletLayout.clock.bottom - 1);
  expect(portraitTabletLayout.toolsTop).toBeGreaterThanOrEqual(
    Math.max(portraitTabletLayout.states.bottom, portraitTabletLayout.calendar.bottom) - 1
  );
  const reducedZoom = await page.evaluate(() => {
    const timer = document.querySelector('#cronoStageIdle .crono-idle-main');
    const calendar = document.querySelector('.crono-calendar-panel');
    const ring = document.getElementById('cronoTimerSvg');
    cronoResetInterfaceScale();
    const before = { timer: timer.getBoundingClientRect().height, calendar: calendar.getBoundingClientRect().height };
    cronoSetInterfaceScale(0.1, { persist: false, announce: false });
    const longText = 'Un destello suficientemente largo para comprobar que el texto se adapta al espacio disponible sin cortarse aunque el cronómetro se reduzca hasta su nuevo mínimo seguro de tamaño.';
    cronoSetIdleDestelloText(longText);
    const message = document.getElementById('cronoIdleMessage');
    const result = {
      scale: Number(document.getElementById('view-cronometro').dataset.interfaceScale),
      timer: timer.getBoundingClientRect().height,
      calendar: calendar.getBoundingClientRect().height,
      ring: ring.getBoundingClientRect().width,
      messageFits: message.scrollHeight <= message.clientHeight + 1,
      messageSize: parseFloat(getComputedStyle(message).fontSize),
      messageClass: message.className,
    };
    cronoSetIdleDestelloText(_cronoIdlePhrase());
    cronoResetInterfaceScale();
    return { before, result };
  });
  expect(reducedZoom.result.scale).toBe(0.5);
  expect(reducedZoom.result.timer).toBeLessThan(reducedZoom.before.timer - 80);
  expect(reducedZoom.result.calendar).toBeLessThan(reducedZoom.before.calendar - 80);
  expect(Math.abs(reducedZoom.result.timer - reducedZoom.result.calendar)).toBeLessThanOrEqual(2);
  expect(reducedZoom.result.ring).toBeLessThanOrEqual(186);
  expect(reducedZoom.result.messageFits).toBe(true);
  expect(reducedZoom.result.messageSize).toBeLessThanOrEqual(10);
  expect(reducedZoom.result.messageClass).toContain('size-xlong');
  const tabletFluidBox = await momentMonitor.locator('.crono-fluid-panel').boundingBox();
  expect(tabletFluidBox.y).toBeGreaterThanOrEqual(0);
  expect(tabletFluidBox.y + tabletFluidBox.height).toBeLessThanOrEqual(1194);
  await expect(momentMonitor.locator('.crono-moment-history')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('.crono-calendar-panel')).toBeHidden();
  await expect(momentMonitor.locator('.crono-fluid-panel')).toBeHidden();
  const mobileTrigger = momentMonitor.locator('.crono-moment-mobile-trigger');
  await expect(mobileTrigger).toBeVisible();
  await expect(momentMonitor.locator('.crono-moment-content')).toBeHidden();
  await mobileTrigger.click();
  await expect(mobileTrigger).toHaveAttribute('aria-expanded', 'true');
  await expect(momentMonitor.locator('.crono-moment-content')).toBeVisible();
  await expect(momentMonitor.locator('#cronoImpulseFaces')).toBeVisible();
  await expect(momentMonitor.locator('#cronoConcentrationFaces')).toBeVisible();
  await expect(momentMonitor.locator('#cronoResistanceFaces')).toBeVisible();
  const mobileContentBox = await momentMonitor.locator('.crono-moment-content').boundingBox();
  expect(mobileContentBox.x).toBeGreaterThanOrEqual(0);
  expect(mobileContentBox.x + mobileContentBox.width).toBeLessThanOrEqual(390);
  expect(mobileContentBox.y).toBeGreaterThanOrEqual(0);
  expect(mobileContentBox.y + mobileContentBox.height).toBeLessThanOrEqual(844);

  await page.evaluate(() => showView('pulse'));
  await expect(page.locator('#pulseDashboard .pulse-card')).toContainText('4 registros');
  await expect(page.locator('#pulseDashboard .pulse-point[aria-label^="Resistencia"]')).toHaveCount(1);
  const pulseChartBox = await page.locator('#pulseDashboard .pulse-chart').boundingBox();
  expect(pulseChartBox.height).toBeGreaterThan(220);
  await page.evaluate(() => showView('session'));
  await expect(page.locator('#statsDashboard .pulse-shortcut')).toBeVisible();
  await expect(page.locator('#statsDashboard .pulse-card')).toHaveCount(0);
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
    _pulseRange = 'dia';
    _pulseOffset = 0;
    renderPulseDashboard();
  });
  await page.evaluate(() => showView('pulse'));

  await expect(page.locator('.pulse-line')).toHaveCount(2);
  await expect(page.locator('.pulse-axis-x')).toHaveText(['09:00', '12:00', '15:00', '18:00', '21:00', '23:00']);
  await expect(page.locator('.pulse-axis-x', { hasText: '00:00' })).toHaveCount(0);
  await expect(page.locator('.pulse-point[aria-label^="Malestar"]')).toHaveCount(2);
  await expect(page.locator('.pulse-point[aria-label*="02:30"]')).toHaveCount(0);
  const smoothPaths = await page.locator('.pulse-line').evaluateAll(paths => paths.map(path => path.getAttribute('d')));
  expect(smoothPaths.every(path => / C[\d.]+,[\d.]+/.test(path || ''))).toBe(true);
  await expect(page.locator('.pulse-gap-line')).toHaveCount(0);
  await expect(page.locator('.pulse-method')).toContainText('Curva continua por métrica');
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
  await expect(page.locator('.pulse-point[aria-label^="Malestar"]')).toHaveCount(0);
  await expect(page.locator('.pulse-point[aria-label^="Concentración"]')).toHaveCount(3);
  await expect(page.locator('body')).toHaveAttribute('data-view', 'pulse');
  await expect(page.locator('body')).not.toHaveClass(/view-swipe-dragging/);
  expect(await page.evaluate(() => [localStorage.getItem('pulse_day_start'), localStorage.getItem('pulse_day_end')])).toEqual(['720', '1080']);
});

test('keeps a 13-inch touch iPad in the tablet layout', async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1366, height: 1024 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await prepare(page);
  const layout = await page.evaluate(() => {
    showView('cronometro');
    const stage = document.getElementById('cronoStageIdle').getBoundingClientRect();
    const monitor = document.querySelector('.crono-moment-monitor').getBoundingClientRect();
    return {
      coarse: matchMedia('(pointer: coarse)').matches,
      desktopPointer: matchMedia('(hover: hover) and (pointer: fine)').matches,
      stageBottom: stage.bottom,
      monitorTop: monitor.top,
      monitorPosition: getComputedStyle(document.querySelector('.crono-moment-monitor')).position,
    };
  });
  expect(layout.coarse).toBe(true);
  expect(layout.desktopPointer).toBe(false);
  expect(layout.monitorPosition).toBe('static');
  expect(layout.monitorTop).toBeGreaterThanOrEqual(layout.stageBottom - 1);
  await context.close();
});

test('places the dedicated pulse screen at the far left of swipe navigation', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    showView('cronometro');
    showViewFromSwipe('pulse');
    return {
      order: SWIPE_VIEW_ORDER.slice(),
      active: document.body.getAttribute('data-view'),
    };
  });
  expect(result).toEqual({
    order: ['pulse', 'session', 'cronometro', 'obras'],
    active: 'pulse',
  });
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
  expect(metrics.columns).toBe(3);
  expect(metrics.controlsInMain).toBe(true);
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
        destello: rect(document.getElementById('cronoIdleMessage')),
        start: rect(document.getElementById('cronoStartBtn')),
        presetCount: document.querySelectorAll('#cronoDurationPresets button').length,
        tabs: [...document.querySelectorAll('#cronoIdleDrawer .crono-idle-drawer-tab')].map(button => button.dataset.tab),
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
        arcColor: getComputedStyle(document.getElementById('cronoRunProgressArc')).stroke,
        handleColor: getComputedStyle(document.getElementById('cronoRunProgressHandle')).fill,
        tabs: [...document.querySelectorAll('#cronoRunDrawer .crono-run-drawer-tab')].map(button => button.dataset.tab),
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
    expect(layout.idle.tabs).toEqual(['pasajes', 'nota', 'tareas', 'pase']);
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

test('uses pinch to distribute space inversely between timer and tools', async ({ page }) => {
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
    const settle = () => new Promise(resolve => setTimeout(resolve, 260));
    const before = { main: rect(main).width, drawer: rect(drawer).width, ring: rect(ring).width };
    cronoSetInterfaceScale(0.84, { persist: false, announce: false });
    await settle();
    const compactClock = { main: rect(main).width, drawer: rect(drawer).width, ring: rect(ring).width };
    cronoSetInterfaceScale(1.18, { persist: true, announce: false });
    await settle();
    const largeClock = { main: rect(main).width, drawer: rect(drawer).width, ring: rect(ring).width };
    const view = document.getElementById('view-cronometro');
    cronoShowInterfaceScale(0.84, false);
    const indicator = document.getElementById('cronoInterfaceZoomIndicator').textContent;
    document.body.classList.add('crono-interface-pinching');
    cronoAnimateInterfaceScale(0.9, { persist: true, announce: false });
    await new Promise(resolve => {
      const startedAt = performance.now();
      const waitForSettle = () => {
        if (!document.body.classList.contains('crono-interface-pinching') || performance.now() - startedAt > 1200) {
          resolve();
          return;
        }
        requestAnimationFrame(waitForSettle);
      };
      waitForSettle();
    });
    const animated = {
      scale: Number(view.dataset.interfaceScale),
      saved: Number(localStorage.getItem(CRONO_INTERFACE_SCALE_KEY)),
      settled: !document.body.classList.contains('crono-interface-pinching'),
    };
    cronoResetInterfaceScale();
    return {
      before,
      compactClock,
      largeClock,
      indicator,
      animated,
      scale: view.dataset.interfaceScale,
      saved: localStorage.getItem(CRONO_INTERFACE_SCALE_KEY),
    };
  });

  expect(result.compactClock.main).toBeLessThan(result.before.main);
  expect(result.compactClock.drawer).toBeGreaterThan(result.before.drawer);
  expect(result.compactClock.ring).toBeLessThan(result.before.ring);
  expect(result.largeClock.main).toBeGreaterThan(result.before.main);
  expect(result.largeClock.drawer).toBeLessThan(result.before.drawer);
  expect(result.largeClock.ring).toBeGreaterThan(result.before.ring);
  expect(result.indicator).toContain('Reloj 84 · Tareas 116');
  expect(result.animated.scale).toBeCloseTo(0.9, 2);
  expect(result.animated.saved).toBeCloseTo(0.9, 2);
  expect(result.animated.settled).toBe(true);
  expect(result.scale).toBe('1');
  expect(result.saved).toBe('1');
});

test('keeps mobile portrait tools dense while inverse pinch exposes more tasks', async ({ page }) => {
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
    await new Promise(resolve => setTimeout(resolve, 260));
    const compact = { ring: ring.getBoundingClientRect().width, drawer: drawer.getBoundingClientRect().height };
    return {
      before,
      compact,
      tabFont: parseFloat(getComputedStyle(document.querySelector('#cronoIdleDrawer .crono-run-drawer-tab')).fontSize),
      taskFont: parseFloat(getComputedStyle(document.querySelector('.crono-task-lane .crono-task-text')).fontSize),
    };
  });

  expect(result.compact.ring).toBeLessThan(result.before.ring);
  expect(result.compact.drawer).toBeGreaterThan(result.before.drawer);
  expect(result.tabFont).toBeLessThanOrEqual(10);
  expect(result.taskFont).toBeLessThanOrEqual(10);
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
    expect(layout.running.controls.top).toBeGreaterThanOrEqual(layout.running.panels.top);
    expect(layout.running.controls.bottom).toBeLessThanOrEqual(layout.running.drawer.bottom + 1);
    await context.close();
  }
});
