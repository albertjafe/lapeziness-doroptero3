import { test, expect } from '@playwright/test';

const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const iso = offset => new Date(Date.now() + offset * 864e5).toISOString();

const fixture = () => ({
  obras: [
    { id: 'waldstein', name: 'Sonata para piano n.º 21 en do mayor, Op. 53 «Waldstein»', composer: 'Beethoven', tipo: 'obra', duracion: 25, dificultad: 8, sol: 64, esc: 70, learningStage: 'consolidando',
      solHistory: [{ val: 64, date: iso(-3) }], paseHistory: [],
      movimientos: [
        { id: 'm1', name: 'Movimiento 1', duracion: null, sol: 6, solHistory: [{ val: 61, date: iso(-3) }], paseHistory: [{ id: 'p1' }] },
        { id: 'm2', name: 'Movimiento 2', duracion: null, sol: 3, solHistory: [], paseHistory: [] },
        { id: 'm3', name: 'Movimiento 3', duracion: null, sol: 7, solHistory: [], paseHistory: [] },
      ] },
    { id: 'ligeti', name: 'Étude n.º 7 «Galamb borong»', composer: 'Ligeti', tipo: 'obra', duracion: 2, sol: 66, solHistory: [{ val: 66, date: iso(-40) }], paseHistory: [], movimientos: [] },
    { id: 'a1', name: 'Lectura', composer: '', tipo: 'actividad' },
  ],
  historicalRepertoire: [{ id: 'h1', name: 'Sonata antigua', composer: 'Mozart', fromYear: 2017, toYear: 2018, estimatedHours: 40, peakLevel: 'solida' }],
  eventos: [{ id: 'e1', nombre: 'Clase', fecha: day(3), tipo: 'clase', obras: ['waldstein'] }],
  sessionPlants: [{ id: 'p1', obraId: 'waldstein', movId: 'm1', mins: 90, startedAt: iso(-1), endedAt: iso(-1) }],
  forestPlants: [], sesiones: [], registro: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [], tiempoDisponibleEventos: [], dailyJournalEntries: [],
});

async function prepare(page, size) {
  await page.setViewportSize(size);
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline test */' }));
  await page.addInitScript(data => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36' });
    Object.defineProperty(navigator, 'userAgentData', { configurable: true, get: () => ({ platform: 'macOS' }) });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, fixture());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ObrasV3 && typeof window.openPremiumWork === 'function' && typeof db !== 'undefined' && db.obras.some(o => o.id === 'waldstein'));
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('obras'); });
}

test('lista limpia: Ahora con evento, solidez del modelo y sin etapas antiguas', async ({ page }) => {
  await prepare(page, { width: 820, height: 1180 });
  const now = page.locator('.ob3-section.is-now');
  await expect(now).toContainText('Ahora');
  const row = page.locator('[data-work-id="waldstein"]');
  await expect(row).toContainText('→ en 3 d · Clase');
  await expect(row).not.toContainText('Consolidando');
  await expect(page.locator('.ob3-section.is-history')).toContainText('Sonata antigua');
  await expect(page.locator('[data-work-id="a1"]')).toHaveCount(0);

  await page.locator('#ob3Search').fill('galamb');
  await expect(page.locator('.ob3-row[data-work-id]')).toHaveCount(1);
  await page.locator('#ob3Search').fill('');
  await page.locator('[data-scope="history"]').click();
  await expect(page.locator('.ob3-row[data-work-id]')).toHaveCount(0);
  await expect(page.locator('[data-history-id="h1"]')).toBeVisible();
});

test('una sola ficha: estudio real, un solo cerrar, edición que guarda y conserva el historial', async ({ page }) => {
  await prepare(page, { width: 820, height: 1180 });
  await page.locator('[data-work-id="waldstein"]').click();
  const sheet = page.locator('#obraPremiumOverlay');
  await expect(sheet).toHaveClass(/open/);
  await expect(sheet.locator('.ob3-title')).toContainText('Waldstein');
  // El catálogo completa al abrir los nombres genéricos y las duraciones vacías.
  await expect(sheet.locator('.ob3-mov').first()).toContainText('I. Allegro con brio');
  await expect(sheet.locator('.ob3-mov').first()).toContainText('≈ 11 min');
  await expect(sheet).toContainText('1 h 30 min');
  await expect(sheet).toContainText('Próximo evento');
  await expect(sheet).not.toContainText('Escena');
  await expect(sheet).not.toContainText('Pases');
  await expect(sheet.locator('[data-action="close"]')).toHaveCount(1);

  await sheet.getByRole('button', { name: 'Editar obra' }).click();
  await page.locator('#obraPremiumDuration').fill('26');
  await page.locator('[data-mov-index="1"] [data-mov-field="duracion"]').fill('4.5');
  await sheet.getByRole('button', { name: 'Guardar cambios' }).click();
  await expect(sheet).toContainText('Cambios guardados.');
  const saved = await page.evaluate(() => {
    const obra = db.obras.find(item => item.id === 'waldstein');
    return { duration: obra.duracion, movementDuration: obra.movimientos[1].duracion, movementSource: obra.movimientos[1].duracionFuente, firstPassId: obra.movimientos[0].paseHistory[0]?.id, dificultadFuente: obra.dificultadFuente || '' };
  });
  expect(saved).toEqual({ duration: 26, movementDuration: 4.5, movementSource: 'manual', firstPassId: 'p1', dificultadFuente: expect.not.stringMatching(/^manual$/) });

  await sheet.locator('[data-action="close"]').click();
  await expect(sheet).not.toHaveClass(/open/);
});

test('iPad horizontal: lista y ficha fija al lado; Registrar solidez abre su ventana encima', async ({ page }) => {
  await prepare(page, { width: 1180, height: 820 });
  const pane = page.locator('#obrasDetail');
  await page.locator('[data-work-id="ligeti"]').click();
  await expect(pane).toContainText('Galamb borong');
  await expect(page.locator('[data-work-id="ligeti"]')).toHaveClass(/is-selected/);
  await expect(page.locator('#obraPremiumOverlay.open')).toHaveCount(0);
  await pane.getByRole('button', { name: 'Registrar solidez' }).click();
  await expect(page.locator('#modalPaseQuality')).toHaveClass(/visible/);
});
