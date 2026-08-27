import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{
    id: 'waldstein', name: 'Sonata para piano n.º 21 en do mayor, Op. 53 «Waldstein»', composer: 'Beethoven', tipo: 'obra',
    duracion: 25, dificultad: 8, sol: 64, esc: 70, minutosExtra: 120,
    movimientos: [
      { id: 'm1', name: 'Movimiento 1', duracion: null, sol: 6, solHistory: [{ val: 61, date: '2026-08-01T10:00:00Z' }], paseHistory: [{ id: 'p1' }] },
      { id: 'm2', name: 'Movimiento 2', duracion: null, sol: 3, solHistory: [], paseHistory: [] },
      { id: 'm3', name: 'Movimiento 3', duracion: null, sol: 7, solHistory: [], paseHistory: [] },
    ],
    paseHistory: [], solHistory: [],
  }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline test */' }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openPremiumWork === 'function');
}

test('opens one premium work sheet and edits it without a second modal', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => openPremiumWork('waldstein'));

  const overlay = page.locator('#obraPremiumOverlay');
  await expect(overlay).toHaveClass(/open/);
  await expect(overlay.locator('.obra-premium-title')).toContainText('Waldstein');
  await expect(overlay.locator('.obra-premium-movement')).toHaveCount(3);
  await expect(overlay.locator('.obra-premium-movement').first()).toContainText('I. Allegro con brio');
  await expect(overlay.locator('.obra-premium-movement').first()).toContainText('≈ 11 min');
  await expect(page.locator('#modalEditObra')).not.toHaveClass(/visible|open/);

  await overlay.getByRole('button', { name: 'Editar obra' }).click();
  await expect(page.locator('#obraPremiumDuration')).toBeVisible();
  await page.locator('#obraPremiumDuration').fill('26');
  await page.locator('[data-mov-index="1"] [data-mov-field="duracion"]').fill('4.5');
  await overlay.getByRole('button', { name: 'Guardar cambios' }).click();

  const saved = await page.evaluate(() => {
    const obra = DB.obras.find(item => item.id === 'waldstein');
    return {
      duration: obra.duracion,
      movementDuration: obra.movimientos[1].duracion,
      movementSource: obra.movimientos[1].duracionFuente,
      firstPassId: obra.movimientos[0].paseHistory[0]?.id,
    };
  });
  expect(saved).toEqual({ duration: 26, movementDuration: 4.5, movementSource: 'manual', firstPassId: 'p1' });
});
