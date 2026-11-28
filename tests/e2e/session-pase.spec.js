import { test, expect } from '@playwright/test';

// 28-11-2026: un pase se prepara antes de plantar (obras, movimientos y tipo)
// y al terminar solo se dice cómo salió; queda en el diario con su tipo.
const work = {
  id: 'w', name: 'Sonata', composer: 'C', tipo: 'obra', sol: 50, solHistory: [],
  movimientos: [{ id: 'm1', name: 'I', duracion: 10, sol: 50, solHistory: [] }, { id: 'm2', name: 'II', duracion: 5, sol: 50, solHistory: [] }],
};
const data = {
  obras: [work], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

test.use({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});

async function boot(page) {
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
    window.cronoMaybeBlockUrgentTasks = () => false;
  });
}

async function preparePase(page, tipo) {
  const row = page.locator('#cronoPassagePick');
  await row.getByRole('button', { name: 'Preparar un pase' }).click();
  const modal = page.locator('#modalCronoPaseRapido');
  await expect(modal).toHaveClass(/visible/);
  await expect(page.locator('#cronoPaseModalTitle')).toHaveText('¿Qué vas a pasar?');
  await modal.locator('.crono-pase-picker-item', { hasText: 'I' }).first().click();
  await modal.locator('.crono-pase-picker-item', { hasText: 'II' }).click();
  await modal.locator('#spPasePlanBar').getByRole('button', { name: tipo }).click();
  await page.screenshot({ path: 'test-results/session-pase-plan.png' });
  await modal.getByRole('button', { name: 'Listo (2)' }).click();
  await expect(modal).not.toHaveClass(/visible/);
  await expect(row.locator('.sp-pase')).toHaveText('🎭 Pase (2) · ' + tipo);
}

test('a planned pase is filled in at the end and lands in the diary with its type', async ({ page }) => {
  await boot(page);
  await preparePase(page, 'Grabación');
  // El cronómetro se pone en la primera obra del pase.
  expect(await page.evaluate(() => document.getElementById('cronoObraSelect').value)).toBe('mov::w::m1');
  await page.screenshot({ path: 'test-results/session-pase-chip.png' });

  await page.evaluate(async () => { await cronoStart(); crono.startTs = Date.now() - 15 * 60000 - 20000; cronoSaveState(); cronoFinish(); });
  const modal = page.locator('#modalCronoPaseRapido');
  await expect(modal).toHaveClass(/visible/);
  await expect(page.locator('#cronoPaseModalTitle')).toHaveText('¿Cómo ha salido el pase?');
  await expect(modal.locator('.crono-pase-item-name')).toHaveCount(2);
  await expect(modal.locator('#cronoPaseDetailStage .pase-tipo-btn.grabacion')).toHaveClass(/active/);
  expect(await modal.locator('.crono-pase-min').evaluateAll(els => els.map(e => Number(e.value)))).toEqual([10, 5]);
  await expect(modal.locator('#spPaseSkip')).toBeVisible();
  await page.screenshot({ path: 'test-results/session-pase-finish.png' });
  await modal.getByRole('button', { name: 'Guardar pases' }).click();
  await expect(modal).not.toHaveClass(/visible/);

  const result = await page.evaluate(() => ({
    state: crono.state,
    plants: db.sessionPlants.map(p => ({ pase: !!p.pase, tipo: p.paseTipo || null, movId: p.movId, mins: p.mins, failed: !!p.failed })),
    plan: localStorage.getItem('cronoPasePlan_v1'),
  }));
  // Solo los dos pases: ni sesión fallida ni minutos contados dos veces.
  expect(result).toEqual({
    state: 'idle',
    plants: [{ pase: true, tipo: 'grabacion', movId: 'm1', mins: 10, failed: false }, { pase: true, tipo: 'grabacion', movId: 'm2', mins: 5, failed: false }],
    plan: null,
  });
  await expect(page.locator('#modalHechoDatos')).not.toHaveClass(/visible/);

  await page.evaluate(() => showView('diario'));
  await expect(page.locator('#view-diario .dia-item.is-pase').first()).toContainText('Pase · grabación');
});

test('if there was no pase in the end, the session is saved as study', async ({ page }) => {
  await boot(page);
  await preparePase(page, 'Solo');
  await page.evaluate(async () => { await cronoStart(); crono.startTs = Date.now() - 20 * 60000; cronoSaveState(); cronoFinish(); });
  const modal = page.locator('#modalCronoPaseRapido');
  await expect(modal).toHaveClass(/visible/);
  await modal.locator('#spPaseSkip').click();
  await expect(page.locator('#modalHechoDatos')).toHaveClass(/visible/, { timeout: 8000 });
  const plants = await page.evaluate(() => db.sessionPlants.map(p => ({ pase: !!p.pase, mins: p.mins })));
  expect(plants).toEqual([{ pase: false, mins: 20 }]);
  expect(await page.evaluate(() => localStorage.getItem('cronoPasePlan_v1'))).toBeNull();
});
