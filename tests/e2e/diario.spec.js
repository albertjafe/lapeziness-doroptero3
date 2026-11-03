import { test, expect } from '@playwright/test';

const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const at = (h, m, offset = 0) => { const d = today(); d.setDate(d.getDate() + offset); d.setHours(h, m, 0, 0); return d.toISOString(); };
const plant = (id, obraId, h1, m1, h2, m2, extra = {}) => ({
  id, obraId, movId: extra.movId || null, startedAt: at(h1, m1, extra.offset), endedAt: at(h2, m2, extra.offset),
  mins: (h2 * 60 + m2) - (h1 * 60 + m1), source: 'app', ...extra,
});

async function boot(page, extra = {}) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const data = {
    competitionPlanningSeedVersion: 999, eventos: [], sesiones: [], forestPlants: [], registro: [],
    obras: [
      { id: 'haydn', name: 'Sonata Hob. XVI:52', composer: 'Haydn', movimientos: [{ id: 'h1', name: 'I. Allegro' }] },
      { id: 'chopin', name: 'Balada n.º 4', composer: 'Chopin' },
    ],
    sessionPlants: [
      plant('a', 'haydn', 9, 0, 9, 40, { movId: 'h1', notes: [{ text: 'probar el pedal más corto', phaseLabel: 'min 12' }] }),
      plant('b', 'haydn', 9, 50, 10, 30, { movId: 'h1' }),
      plant('c', 'chopin', 10, 45, 11, 30),
      plant('y', 'chopin', 17, 0, 18, 0, { offset: -1 }),
    ],
    ...extra,
  };
  await page.addInitScript(d => { if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(d)); }, data);
  await page.goto('/');
  await page.waitForFunction(() => window.Diario && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} });
}

const stored = page => page.evaluate(() => JSON.parse(localStorage.getItem('alberto_piano_v2') || '{}').dailyJournalEntries || []);

test('Diario: pestaña propia; lo estudiado aparece solo y lo escrito se guarda solo, unido a su bloque', async ({ page }) => {
  await boot(page);
  await page.locator('.nav-btn[data-view="diario"]').first().click();
  const view = page.locator('#view-diario');
  await expect(view).toHaveClass(/active/);
  await expect(page.locator('#headerTitle')).toHaveText('Diario');
  const items = view.locator('.dia-item');
  await expect(items).toHaveCount(2);
  await expect(items.nth(0).locator('.dia-time')).toHaveText('09:00–10:30');
  await expect(items.nth(0).locator('.dia-title')).toHaveText('Haydn · Sonata Hob. XVI:52');
  await expect(items.nth(0).locator('.dia-crono')).toContainText('probar el pedal más corto');

  // Tocar el bloque lleva a escribir; sin botón de guardar.
  await items.nth(0).locator('.dia-meta').click();
  await expect(items.nth(0).locator('.dia-ink')).toBeFocused();
  await page.keyboard.type('El desarrollo sigue sucio en la mano izquierda');
  await expect.poll(async () => (await stored(page)).map(e => [e.text, e.ref, e.day])).toEqual([
    ['El desarrollo sigue sucio en la mano izquierda', 'p:a', keyOf(today())],
  ]);
  expect((await stored(page))[0].about).toBe('Haydn · Sonata Hob. XVI:52 · I. Allegro · 09:00–10:30');

  // Una línea libre del día.
  await view.locator('.dia-new .dia-ink').fill('Día tranquilo');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await stored(page)).map(e => e.text).sort()).toEqual(['Día tranquilo', 'El desarrollo sigue sucio en la mano izquierda']);

  // Al volver, todo sigue en su sitio.
  await page.reload();
  await page.waitForFunction(() => window.Diario && typeof showView === 'function');
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('diario'); });
  await expect(view.locator('.dia-item').first().locator('.dia-ink')).toHaveValue('El desarrollo sigue sucio en la mano izquierda');
  await expect(view.locator('.dia-free:not(.dia-new) .dia-ink')).toHaveValue('Día tranquilo');

  // Vaciar un comentario y salir de la línea lo quita.
  const ink = view.locator('.dia-item').first().locator('.dia-ink');
  await ink.fill('');
  await ink.blur();
  await expect.poll(async () => (await stored(page)).map(e => e.text)).toEqual(['Día tranquilo']);
});

test('Diario: se pasa de un día a otro y no deja ir al futuro', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => showView('diario'));
  const view = page.locator('#view-diario');
  await expect(view.locator('[data-act="next"]')).toBeDisabled();
  await view.locator('[data-act="prev"]').click();
  await expect(view.locator('.dia-item')).toHaveCount(1);
  await expect(view.locator('.dia-item .dia-title')).toHaveText('Chopin · Balada n.º 4');
  await expect(view.locator('[data-act="today"]')).toBeVisible();
  await view.locator('[data-act="today"]').click();
  await expect(view.locator('.dia-item')).toHaveCount(2);
});
