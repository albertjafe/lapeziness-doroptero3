import { test, expect } from '@playwright/test';

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

function fixture() {
  return {
    obras: [work],
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
  await page.locator('#cronoPassageTracker .crono-passage-score').click();
  await page.locator('#passageRatingSlider').evaluate((slider, next) => {
    slider.value = String(next);
    slider.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
  await page.locator('#passageRatingSave').click();
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

test('records cold score, explicit focus time and optional post score without assigning the master session', async ({ page }) => {
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
  await expect(page.locator('#cronoPassageTracker .crono-passage-score')).toContainText('58');

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
  expect(result.saved[0].coldScore).toBe(58);
  expect(result.saved[0].postScore).toBe(73);
  expect(result.saved[0].focusedMs).toBeGreaterThanOrEqual(900);
  expect(result.saved[0].focusedMs).toBeLessThan(2500);
  expect(result.saved[0].focusChunks).toHaveLength(1);
  expect(result.saved[0].obraId).toBe('obra_passage');
  expect(result.saved[0].movId).toBe('m1');
  expect(result.saved[0].difficulty).toBe(8.7);
  expect(result.tracker.observations).toHaveLength(1);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('alberto_piano_v2')).passageTracker);
  expect(stored.observations).toHaveLength(1);
  expect(stored.observations[0].coldScore).toBe(58);
  expect(stored.observations[0].postScore).toBe(73);
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
