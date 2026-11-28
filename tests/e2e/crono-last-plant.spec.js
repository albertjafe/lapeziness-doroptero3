import { test, expect } from '@playwright/test';

// 28-11-2026: el cronómetro se prepara con lo último plantado, también si se
// plantó en otro aparato (llega por la sincronización con `timerMinutes`).
const work = {
  id: 'w', name: 'Sonata', composer: 'C', tipo: 'obra', sol: 50, solHistory: [],
  movimientos: [{ id: 'm1', name: 'I', sol: 50, solHistory: [] }, { id: 'm2', name: 'II', sol: 50, solHistory: [] }],
};
const ago = min => new Date(Date.now() - min * 60000).toISOString();
const data = plants => ({
  obras: [work], eventos: [], sesiones: [], registro: [], sessionPlants: plants, forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
});

async function prepare(page, plants) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(d => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('alberto_piano_v2', JSON.stringify(d));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data(plants));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cronoHydrate === 'function');
  await page.evaluate(() => cronoHydrate());
}

const enterCrono = page => page.evaluate(async () => {
  showView('session'); await new Promise(r => setTimeout(r, 200));
  showView('cronometro'); await new Promise(r => setTimeout(r, 300));
  return { mode: crono.mode, minutes: crono.timerMinutes, target: document.getElementById('cronoObraSelect').value };
});

test('adopts the last plant from another device once, and keeps later local changes', async ({ page }) => {
  await prepare(page, [
    { id: 'run_old', runId: 'old', obraId: 'w', movId: 'm1', source: 'app', startedAt: ago(200), endedAt: ago(170), mins: 30 },
    { id: 'run_ipad', runId: 'ipad', obraId: 'w', movId: 'm2', source: 'app', startedAt: ago(50), endedAt: ago(10), mins: 40, timerMinutes: 40 },
  ]);
  expect(await enterCrono(page)).toEqual({ mode: 'timer', minutes: 40, target: 'mov::w::m2' });

  // Lo que se cambie aquí después no lo pisa la misma plantación.
  await page.evaluate(() => cronoSetTimerPreset(20));
  expect(await enterCrono(page)).toEqual({ mode: 'timer', minutes: 20, target: 'mov::w::m2' });
  await page.reload();
  await page.waitForFunction(() => typeof cronoHydrate === 'function');
  await page.evaluate(() => cronoHydrate());
  expect(await enterCrono(page)).toEqual({ mode: 'timer', minutes: 20, target: 'mov::w::m2' });

  // Una nueva en modo libre (timerMinutes 0) llega por la sincronización.
  await page.evaluate(t => { db.sessionPlants.push({ id: 'run_ipad2', runId: 'ipad2', obraId: 'w', movId: 'm1', source: 'app', startedAt: t[0], endedAt: t[1], mins: 15, timerMinutes: 0 }); saveLocalNow(); }, [ago(16), ago(0.5)]);
  expect(await enterCrono(page)).toEqual({ mode: 'stopwatch', minutes: 20, target: 'mov::w::m1' });
});

test('a plant made here records its timer minutes', async ({ page }) => {
  await prepare(page, []);
  const plant = await page.evaluate(async () => {
    showView('cronometro');
    window.cronoMaybeBlockUrgentTasks = () => false;
    cronoSetTimerPreset(35);
    document.getElementById('cronoObraSelect').value = 'mov::w::m1';
    cronoUpdateStartBtn();
    await cronoStart();
    const run = crono.runId;
    crono.startTs = Date.now() - 36 * 60000;
    cronoSaveState();
    await new Promise(r => setTimeout(r, 2500));
    const p = db.sessionPlants.find(x => x.runId === run);
    return p && { minutes: p.timerMinutes, seen: JSON.parse(localStorage.getItem('cronoPlantSeen_v2')).own === 'run_' + run };
  });
  expect(plant).toEqual({ minutes: 35, seen: true });
});
