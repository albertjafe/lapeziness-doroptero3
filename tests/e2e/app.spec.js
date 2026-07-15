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

test('implements phase three Hoy and Cronómetro hierarchy', async ({ page }) => {
  await prepare(page);
  const state = await page.evaluate(() => {
    showView('session');
    const hoy = {
      nav: document.querySelector('.nav-btn[data-view="session"]')?.textContent.trim(),
      action: document.getElementById('sessionStartStudyBtn')?.textContent.trim(),
      summary: document.getElementById('sessionResumenCard')?.textContent || '',
      journal: [...document.querySelectorAll('#view-session button')].find(button => /Guardar entrada/.test(button.textContent))?.textContent.trim(),
      nudge: document.querySelector('.session-insight-card.nudge'),
    };
    showView('cronometro');
    return {
      hoy,
      cronoStart: document.getElementById('cronoStartBtn')?.textContent.trim(),
      quickNoteButtons: document.querySelectorAll('#cronoQuickNoteBtn').length,
      runTabs: [...document.querySelectorAll('#cronoRunDrawer .crono-run-drawer-tab')].map(button => button.dataset.tab),
      bottomDisplay: getComputedStyle(document.querySelector('#view-cronometro .crono-bottom-row')).display,
    };
  });
  expect(state.hoy.nav).toBe('Hoy');
  expect(state.hoy.action).toBe('Empezar a estudiar');
  expect(state.hoy.summary).toContain('Aún sin actividad registrada');
  expect(state.hoy.journal).toBe('Guardar entrada');
  expect(state.hoy.nudge).toBeNull();
  expect(state.cronoStart).toBe('Iniciar');
  expect(state.quickNoteButtons).toBe(0);
  expect(state.runTabs).toEqual(['pasajes', 'nota', 'tareas']);
  expect(state.bottomDisplay).toBe('none');
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
      return {
        portrait: matchMedia('(orientation: portrait)').matches,
        stage: { top: stage.top, right: stage.right, bottom: stage.bottom },
        drawer: { top: drawer.top, left: drawer.left, bottom: drawer.bottom },
        controlsBottom: controls.bottom,
        viewportHeight: innerHeight,
        fitsWidth: document.documentElement.scrollWidth <= innerWidth + 1,
        objective: document.getElementById('cronoRunObjectiveText').textContent,
        passage: document.querySelector('.crono-focus-pasaje-copy strong')?.textContent,
      };
    });

    expect(layout.fitsWidth).toBe(true);
    expect(layout.objective).toBe('Coda limpia, pulso estable');
    expect(layout.passage).toBe('Coda · cc. 200–208');
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

test('finishes a valid timer without native confirmation and saves one-tap solidity', async ({ page }) => {
  let nativeDialogs = 0;
  page.on('dialog', async dialog => {
    nativeDialogs += 1;
    await dialog.dismiss();
  });
  await prepare(page);
  await page.evaluate(() => {
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

  const modal = page.locator('#modalHechoDatos');
  await expect(modal).toHaveClass(/visible/);
  await expect(modal.locator('#hechoSavedMinutes')).toHaveText('25 min guardados');
  expect(nativeDialogs).toBe(0);

  const stable = modal.locator('.hecho-solidez-options button[data-value="65"]');
  await stable.click();
  await expect(stable).toHaveAttribute('aria-checked', 'true');
  await modal.getByRole('button', { name: 'Listo' }).click();
  await expect(modal).not.toHaveClass(/visible/);

  const saved = await page.evaluate(() => ({
    value: db.obras[0].solHistory[0]?.val,
    context: db.obras[0].solHistory[0]?.context,
    current: db.obras[0].sol,
  }));
  expect(saved).toEqual({ value: 65, context: 'cierre-sesion', current: 65 });
});
