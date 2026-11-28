import { test, expect } from '@playwright/test';

// 28-11-2026: pasajes elegidos antes de plantar, valorados al terminar y
// guardados en el diario.
const work = {
  id: 'w', name: 'Sonata', composer: 'C', tipo: 'obra', sol: 50, solHistory: [],
  movimientos: [{ id: 'm1', name: 'I', sol: 50, solHistory: [] }, { id: 'm2', name: 'II', sol: 50, solHistory: [] }],
};
const data = {
  obras: [work], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
  passageTracker: { version: 3, passages: [{ id: 'oct', obraId: 'w', movId: 'm1', name: 'Octavas', difficulty: 8, createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z' }], observations: [] },
  journalSections: [],
};

// Como en el iPhone: así se ve la disposición de móvil.
test.use({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

test('pick passages, plant, rate them and find the note in the diary', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(d => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('alberto_piano_v2', JSON.stringify(d));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof cronoHydrate === 'function' && window.SessionPassages);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(async () => {
    try { closeModal('modalCloudSync'); } catch (e) {}
    await cronoHydrate();
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'mov::w::m1';
    cronoUpdateStartBtn();
  });

  const row = page.locator('#cronoPassagePick');
  await expect(row).toBeVisible();
  await expect(row.locator('.sp-chip[data-sp-id]')).toHaveText(['Octavas']);

  // Uno de la lista y otro nuevo, sin salir del cronómetro.
  await row.getByRole('button', { name: 'Octavas' }).click();
  await row.getByRole('button', { name: 'Añadir un pasaje' }).click();
  await row.locator('.sp-new-input').fill('Coda');
  await row.locator('.sp-new-input').press('Enter');
  await expect(row.locator('.sp-chip.is-on')).toHaveText(['✓ Coda', '✓ Octavas']);
  await page.screenshot({ path: 'test-results/session-passages-pick.png' });

  await page.evaluate(async () => {
    window.cronoMaybeBlockUrgentTasks = () => false;
    cronoSetTimerPreset(30);
    await cronoStart();
  });
  await expect(row).toBeHidden();
  await page.evaluate(() => { crono.startTs = Date.now() - 31 * 60000; cronoSaveState(); });

  const section = page.locator('#hechoSessionPassages');
  await expect(section).toBeVisible({ timeout: 8000 });
  await expect(section.locator('.sp-hecho-name')).toHaveText(['Coda', 'Octavas']);
  await section.locator('.sp-hecho-row').nth(1).getByRole('button', { name: 'Bien' }).click();
  await section.locator('.sp-hecho-row').nth(0).getByRole('button', { name: 'Regular' }).click();
  await section.locator('.sp-note').nth(0).fill('falta el final');
  await section.screenshot({ path: 'test-results/session-passages-hecho.png' });
  await page.locator('#modalHechoDatos').getByRole('button', { name: 'Hecho', exact: true }).click();

  const saved = await page.evaluate(() => {
    const e = db.dailyJournalEntries.find(x => x.source === 'crono-passages');
    const plant = db.sessionPlants[db.sessionPlants.length - 1];
    return e && { text: e.text, ref: e.ref, plantRef: 'p:' + plant.id, ratings: e.ratings, obs: db.passageTracker.observations.filter(o => o.source === 'session-passages-v1').map(o => o.score) };
  });
  expect(saved).toEqual({ text: '[[Coda]]\nRegular: falta el final\n[[Octavas]]\nBien', ref: saved.plantRef, plantRef: saved.plantRef, ratings: expect.objectContaining({ oct: 'bien' }), obs: [85] });

  // En el diario sale bajo su bloque de estudio.
  await page.evaluate(() => showView('diario'));
  const diary = page.locator('#view-diario');
  await expect(diary).toContainText('Regular: falta el final');
  await expect(diary.locator('.dia-section-heading')).toContainText(['Coda', 'Octavas']);

  // La próxima vez vienen ya marcados.
  await page.evaluate(() => { showView('cronometro'); window.SessionPassages.render(); });
  await expect(row.locator('.sp-chip.is-on')).toHaveText(['✓ Coda', '✓ Octavas']);
});

test.describe('iPad', () => {
  test.use({
    viewport: { width: 1024, height: 1366 }, isMobile: true, hasTouch: true,
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  });
  test('the passage row shows under the work', async ({ page }) => {
    await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
    await page.addInitScript(d => {
      localStorage.setItem('alberto_piano_v2', JSON.stringify(d));
      localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    }, data);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof cronoHydrate === 'function' && window.SessionPassages);
    await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
    await page.evaluate(async () => {
      try { closeModal('modalCloudSync'); } catch (e) {}
      await cronoHydrate();
      showView('cronometro');
      document.getElementById('cronoObraSelect').value = 'mov::w::m1';
      cronoUpdateStartBtn();
    });
    const row = page.locator('#cronoPassagePick');
    await expect(row.getByRole('button', { name: 'Octavas' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Añadir un pasaje' })).toBeVisible();
    await page.screenshot({ path: 'test-results/session-passages-ipad.png' });
  });
});
