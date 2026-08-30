import { test, expect } from '@playwright/test';

const multiWork = {
  id: 'obra_multi',
  name: 'Sonata de prueba',
  composer: 'Compositor',
  tipo: 'obra',
  sol: 70,
  solHistory: [],
  movimientos: [
    { id: 'm1', name: 'I. Allegro', sol: 70, solHistory: [] },
    { id: 'm2', name: 'II. Adagio', sol: 70, solHistory: [] },
    { id: 'm3', name: 'III. Finale', sol: 70, solHistory: [] },
  ],
};

function fixture(sessionPlants = []) {
  return {
    obras: [multiWork],
    eventos: [], sesiones: [], registro: [], sessionPlants, forestPlants: [],
    estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
    tiempoDisponibleEventos: [], dailyJournalEntries: [],
  };
}

async function prepare(page, { data = fixture(), lastTarget = '' } = {}) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en tests */',
  }));
  await page.addInitScript(({ data, lastTarget }) => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    if (lastTarget) localStorage.setItem('cronoLastStudyTarget_v1', lastTarget);
    else localStorage.removeItem('cronoLastStudyTarget_v1');
  }, { data, lastTarget });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
}

test('adds an expandable, detailed guide to the done rating pill', async ({ page }) => {
  await prepare(page);

  const guide = page.locator('#hechoRatingGuide');
  await expect(guide).toHaveCount(1);
  await expect(guide.locator('summary')).toContainText('¿Qué significa cada rango?');
  await guide.locator('summary').click();
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide).toContainText('Memorizada · asentando');
  await expect(guide).toContainText('70–75');
  await expect(guide).toContainText('Nivel concierto');
  await expect(guide).toContainText('100 no significa perfección humana');

  await page.evaluate(() => hechoSelectSolidez(pasePctToPosition(72)));
  const current = guide.locator('.hecho-rating-guide-row.is-current');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText('65–79');
});

test('restores the exact last planted movement after reopening the stopwatch', async ({ page }) => {
  await prepare(page, { lastTarget: 'mov::obra_multi::m3' });
  await page.evaluate(() => showView('cronometro'));

  await expect(page.locator('#cronoObraSelect')).toHaveValue('mov::obra_multi::m3');
  await expect(page.locator('#cronoObraSelectBtnLabel')).toContainText('III. Finale');
});

test('migrates the exact movement from the most recent real app plant', async ({ page }) => {
  const plants = [
    {
      id: 'old-m1', obraId: 'obra_multi', movId: 'm1', source: 'app', mins: 20,
      startedAt: '2026-08-20T10:00:00.000Z', endedAt: '2026-08-20T10:20:00.000Z',
    },
    {
      id: 'latest-m3', obraId: 'obra_multi', movId: 'm3', source: 'app', mins: 25,
      startedAt: '2026-08-29T10:00:00.000Z', endedAt: '2026-08-29T10:25:00.000Z',
    },
  ];
  await prepare(page, { data: fixture(plants) });
  await page.evaluate(() => showView('cronometro'));

  await expect(page.locator('#cronoObraSelect')).toHaveValue('mov::obra_multi::m3');
  expect(await page.evaluate(() => localStorage.getItem('cronoLastStudyTarget_v1'))).toBe('mov::obra_multi::m3');
});

test('records obra plus movement when a new stopwatch session actually starts', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'mov::obra_multi::m3';
    crono.mode = 'stopwatch';
    cronoUpdateStartBtn();
    cronoStart();
    const snapshot = {
      state: crono.state,
      obraId: crono.obraId,
      movId: crono.movId,
      stored: localStorage.getItem('cronoLastStudyTarget_v1'),
    };
    if (crono.tickInterval) clearInterval(crono.tickInterval);
    crono.tickInterval = null;
    crono.state = 'idle';
    return snapshot;
  });

  expect(result).toMatchObject({
    state: 'running',
    obraId: 'obra_multi',
    movId: 'm3',
    stored: 'mov::obra_multi::m3',
  });
});
