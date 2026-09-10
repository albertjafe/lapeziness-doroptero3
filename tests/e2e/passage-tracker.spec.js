import { test, expect } from '@playwright/test';

const general = {
  id: 'general',
  name: 'General',
  tipo: 'actividad',
  sol: 0,
  solHistory: [],
  movimientos: [],
};

const work = {
  id: 'obra_passage',
  name: 'Sonata de pasajes',
  composer: 'Compositor',
  tipo: 'obra',
  sol: 68,
  solHistory: [],
  movimientos: [
    { id: 'm1', name: 'I. Allegro', sol: 66, solHistory: [] },
    { id: 'm2', name: 'II. Finale', sol: 70, solHistory: [] },
  ],
};

const secondWork = {
  id: 'obra_second',
  name: 'Segunda obra',
  composer: 'Otra compositora',
  tipo: 'obra',
  sol: 61,
  solHistory: [],
  movimientos: [
    { id: 's1', name: 'I. Vivo', sol: 61, solHistory: [] },
  ],
};

function fixture() {
  return {
    obras: [general, work, secondWork],
    eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
    estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
    tiempoDisponibleEventos: [], dailyJournalEntries: [],
  };
}

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en tests */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    localStorage.removeItem('alberto_passage_tracker_v1');
  }, fixture());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(900);
  await expect.poll(() => page.evaluate(() => !!window.PassageTracker)).toBe(true);
  await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'mov::obra_passage::m1';
    cronoUpdateSelectBtn();
    cronoUpdateStartBtn();
    cronoSetIdleDrawerTab('pasajes');
    PassageTracker.render();
  });
}

async function addPassage(page, name = 'Octavas finales', difficulty = '8.7') {
  await page.locator('#cronoPassageTracker .crono-passage-add').click();
  await page.locator('#passageEditorName').fill(name);
  await page.locator('#passageEditorDifficulty').fill(difficulty);
  await page.locator('#passageEditorSave').click();
  await expect(page.locator('#cronoPassageTracker .crono-passage-row')).toHaveCount(1);
}

async function setRating(page, value) {
  await page.locator('#cronoPassageTracker .passage-inline-meter .pase-liquid-input').evaluate((slider, next) => {
    slider.value = pasePctToPosition(next).toFixed(2);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.evaluate(() => PassageTracker.flushPendingScores('test'));
}

test('passages belong to the exact movement and empty scopes only show add', async ({ page }) => {
  await prepare(page);
  await expect(page.locator('#cronoPassageTracker .crono-passage-add')).toHaveCount(1);
  await expect(page.locator('#cronoPassageTracker .crono-passage-head')).toHaveCount(0);

  await addPassage(page);
  await expect(page.locator('#cronoPassageTracker')).toContainText('Octavas finales');
  await expect(page.locator('#cronoPassageTracker')).toContainText('Dificultad 8.7');

  await page.evaluate(() => {
    const select = document.getElementById('cronoObraSelect');
    select.value = 'mov::obra_passage::m2';
    cronoUpdateSelectBtn();
    cronoUpdateStartBtn();
    cronoSetIdleDrawerTab('pasajes');
    PassageTracker.render();
  });
  await expect(page.locator('#cronoPassageTracker .crono-passage-row')).toHaveCount(0);
  await expect(page.locator('#cronoPassageTracker .crono-passage-add')).toHaveCount(1);
});

test('waits five seconds after the last slider change and only saves the final value', async ({ page }) => {
  await prepare(page);
  await addPassage(page);

  const moveSlider = value => page.locator('#cronoPassageTracker .passage-inline-meter .pase-liquid-input').evaluate((slider, next) => {
    slider.value = pasePctToPosition(next).toFixed(2);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);

  await moveSlider(61);
  await page.waitForTimeout(900);
  await moveSlider(64);
  await expect(page.locator('#cronoPassageTracker [data-passage-score-value]')).toHaveText('64');
  await expect(page.locator('#cronoPassageTracker [data-passage-score-description]')).toHaveText('Sale a ratos');
  await page.waitForTimeout(4200);
  await expect.poll(() => page.evaluate(() => PassageTracker.getTracker().observations.length)).toBe(0);
  await expect(page.locator('#cronoPassageTracker [data-passage-score-pending]')).toHaveClass(/is-pending/);

  await expect.poll(
    () => page.evaluate(() => PassageTracker.getTracker().observations.map(item => item.score)),
    { timeout: 2200 },
  ).toEqual([64]);
});

test('shows cumulative learning curves for the movement and each passage', async ({ page }) => {
  await prepare(page);
  await addPassage(page, 'Octavas finales');
  await page.evaluate(() => {
    const movement = db.obras.find(item => item.id === 'obra_passage').movimientos.find(item => item.id === 'm1');
    movement.solHistory = [
      { id:'work-2', date:'2026-09-09T10:20:00Z', inputVal:68, val:68, activeElapsedMs:1200000, runId:'work-run' },
      { id:'work-1', date:'2026-09-09T10:00:00Z', inputVal:48, val:48, activeElapsedMs:0, runId:'work-run' },
    ];
    const passage = db.passageTracker.passages[0];
    db.passageTracker.observations = [
      { id:'pass-1', passageId:passage.id, obraId:passage.obraId, movId:passage.movId, score:42, recordedAt:'2026-09-09T10:00:00Z', activeElapsedMs:0, runId:'pass-run-1' },
      { id:'pass-2', passageId:passage.id, obraId:passage.obraId, movId:passage.movId, score:58, recordedAt:'2026-09-09T10:05:00Z', activeElapsedMs:300000, runId:'pass-run-1' },
      { id:'pass-3', passageId:passage.id, obraId:passage.obraId, movId:passage.movId, score:72, recordedAt:'2026-09-10T09:10:00Z', activeElapsedMs:600000, runId:'pass-run-2' },
    ];
    PassageTracker.render();
  });

  const curve = page.locator('#cronoPassageTracker .passage-learning-curve');
  await expect(curve).toBeVisible();
  await curve.locator('summary').click();
  await expect(curve.locator('.passage-learning-svg')).toBeVisible();
  await expect(curve).toContainText('68%');
  await expect(curve).toContainText('min activos acumulados');
  await curve.getByRole('button', { name: 'Mostrar curva de Octavas finales' }).click();
  await expect(curve).toContainText('72%');
  await expect(curve).toContainText('+30 puntos');
  if (process.env.CAPTURE_PASSAGE_TRACKER) {
    await curve.screenshot({ path: 'test-results/passage-learning-curve.png' });
  }
});

test('direct solidity pills never start the global view swipe and expose the quick guide', async ({ page }) => {
  await prepare(page);
  await addPassage(page);
  await expect(page.locator('#cronoTargetSolidityMeter')).toBeVisible();
  await page.locator('#cronoTargetSolidity .crono-target-solidity-guide summary').click();
  await expect(page.locator('#cronoTargetSolidityGuide')).toContainText('Aprendida');

  const meter = page.locator('#cronoPassageTracker .passage-inline-meter');
  const box = await meter.boundingBox();
  await meter.dispatchEvent('touchstart', {
    touches: [{ identifier: 7, clientX: box.x + 10, clientY: box.y + 10 }],
  });
  await page.locator('body').dispatchEvent('touchmove', {
    touches: [{ identifier: 7, clientX: box.x + 90, clientY: box.y + 10 }],
  });
  await expect(page.locator('body')).not.toHaveClass(/view-swipe-dragging/);
});

test('General shows passages from every work and splits its minutes without changing the total', async ({ page }) => {
  await prepare(page);
  const state = await page.evaluate(() => {
    db.passageTracker = {
      version: 2,
      passages: [
        { id:'warm_a', obraId:'obra_passage', movId:'m1', name:'Octavas de calentamiento', difficulty:8, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null },
        { id:'warm_b', obraId:'obra_second', movId:'s1', name:'Acordes rápidos', difficulty:7, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), deletedAt:null },
      ],
      observations: [],
      updatedAt: new Date().toISOString(),
    };
    localStorage.setItem('alberto_passage_tracker_v1', JSON.stringify(db.passageTracker));
    const select = document.getElementById('cronoObraSelect');
    const option = Array.from(select.options).find(item => /^general$/i.test(String(item.textContent || '').trim()));
    if (option) select.value = option.value;
    else select.value = 'obra::general';
    cronoUpdateSelectBtn();
    cronoUpdateStartBtn();
    cronoSetIdleDrawerTab('pasajes');
    PassageTracker.render();
    return { value: select.value, target: PassageTracker.currentTarget() };
  });

  expect(state.target?.general).toBe(true);
  await expect(page.locator('#cronoPassageTracker .crono-passage-row')).toHaveCount(2);
  await expect(page.locator('#cronoPassageTracker')).toContainText('Sonata de pasajes');
  await expect(page.locator('#cronoPassageTracker')).toContainText('Segunda obra');
  await expect(page.locator('#cronoPassageTracker .crono-passage-add')).toHaveCount(0);

  const allocation = await page.evaluate(() => {
    db.sessionPlants = [{
      id:'general_plant', runId:'general_run', obraId:'general', movId:null, mins:5,
      startedAt:'2026-09-06T08:00:00.000Z', endedAt:'2026-09-06T08:05:00.000Z', kind:'study',
    }];
    const ok = PassageTracker.applyGeneralAllocation({
      generalObraId:'general', runId:'general_run', startedAt:'2026-09-06T08:00:00.000Z',
      allocations:[
        { passageId:'warm_a', obraId:'obra_passage', movId:'m1', focusedMs:60000, chunks:[{startedAt:'2026-09-06T08:00:20.000Z',endedAt:'2026-09-06T08:01:20.000Z',ms:60000}] },
        { passageId:'warm_b', obraId:'obra_second', movId:'s1', focusedMs:120000, chunks:[{startedAt:'2026-09-06T08:02:00.000Z',endedAt:'2026-09-06T08:04:00.000Z',ms:120000}] },
      ],
    });
    return {
      ok,
      plants: db.sessionPlants.map(plant => ({
        obraId:plant.obraId, movId:plant.movId, mins:Number(plant.mins ?? plant.min),
        source:plant.passageAllocationSource || plant.passageAllocation?.source || null,
      })),
    };
  });

  expect(allocation.ok).toBe(true);
  expect(allocation.plants.reduce((sum, plant) => sum + plant.mins, 0)).toBeCloseTo(5, 5);
  expect(allocation.plants.find(plant => plant.obraId === 'general')?.mins).toBeCloseTo(2, 5);
  expect(allocation.plants.find(plant => plant.obraId === 'obra_passage' && plant.movId === 'm1')?.mins).toBeCloseTo(1, 5);
  expect(allocation.plants.find(plant => plant.obraId === 'obra_second' && plant.movId === 's1')?.mins).toBeCloseTo(2, 5);
});

test('records free score observations with exact passage time without assigning the master session', async ({ page }) => {
  await prepare(page);
  await addPassage(page);

  await page.evaluate(() => {
    crono.mode = 'stopwatch';
    cronoUpdateStartBtn();
    cronoStart();
    cronoSetRunDrawerTab('pasajes');
  });
  await expect.poll(() => page.evaluate(() => crono.state)).toBe('running');

  await setRating(page, 58);
  await expect(page.locator('#cronoPassageTracker .crono-passage-inline-score')).toContainText('58');

  await page.locator('#cronoPassageTracker .crono-passage-timer').click();
  await page.waitForTimeout(1150);
  await page.locator('#cronoPassageTracker .crono-passage-timer').click();

  await setRating(page, 73);
  const result = await page.evaluate(() => {
    const saved = PassageTracker.commitDraft();
    const tracker = PassageTracker.getTracker();
    if (crono.tickInterval) clearInterval(crono.tickInterval);
    crono.tickInterval = null;
    crono.state = 'idle';
    return { saved, tracker };
  });

  expect(result.saved).toHaveLength(1);
  expect(result.saved[0].focusedMs).toBeGreaterThanOrEqual(900);
  expect(result.saved[0].focusedMs).toBeLessThan(2500);
  expect(result.saved[0].focusChunks).toHaveLength(1);
  expect(result.tracker.observations).toHaveLength(3);
  expect(result.tracker.observations.filter(item => item.score != null).map(item => item.score)).toEqual([58, 73]);
  expect(result.tracker.observations[1].activeElapsedMs).toBeGreaterThanOrEqual(900);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('alberto_piano_v2')).passageTracker);
  expect(stored.observations).toHaveLength(3);
  expect(stored.observations.filter(item => item.score != null).map(item => item.score)).toEqual([58, 73]);
});

test('iPad landscape alternates tasks and passages in the same drawer', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await prepare(page);
  await addPassage(page);
  const drawer = page.locator('#cronoIdleDrawer');
  await expect(drawer.locator('#cronoPassageTracker')).toBeVisible();
  await expect(drawer.locator('[data-panel="tareas"]')).toBeHidden();
  await drawer.getByRole('tab', {name:'Tareas'}).click();
  await expect(drawer.locator('#cronoPassageTracker')).toBeHidden();
  await expect(drawer.locator('[data-panel="tareas"]')).toBeVisible();
  await drawer.getByRole('tab', {name:'Pasajes', exact:true}).click();
  await expect(drawer.locator('.crono-passage-row')).toHaveCount(1);
});
