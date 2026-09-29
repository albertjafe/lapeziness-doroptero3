import { test, expect } from '@playwright/test';

const day = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
const iso = offset => new Date(Date.now() + offset * 864e5).toISOString();

const fixture = () => ({
  obras: [], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [], tiempoDisponibleEventos: [], dailyJournalEntries: [],
  habitChallenges: [
    { id: 'detox', title: 'Desintoxicación por la mañana', mode: 'avoid', startDate: day(-2), durationDays: 21, logs: {}, createdAt: iso(-2), updatedAt: iso(-2) },
    { id: 'bed', title: 'No móvil en la cama', mode: 'avoid', startDate: day(-60), durationDays: 21, logs: {}, createdAt: iso(-60), updatedAt: iso(-60) },
  ],
});

test('hub de Hoy: día del reto, recaída con acciones sugeridas que salen en Hoy y en el calendario', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline test */' }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, fixture());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HabitHub && window.MobileV2 && document.querySelector('.mv2-habits'));
  // El aviso de la nube se abre al terminar la pantalla de inicio: se cierra después.
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });

  const card = page.locator('.mv2-habits');
  await expect(card).toContainText('Desintoxicación por la mañana');
  await expect(card).toContainText('Evitar · día 3 de 21');
  await expect(card).toContainText('Hoy, sin recaída');
  await expect(card).toContainText('En mantenimiento');
  await expect(card).toContainText('No móvil en la cama');

  await card.locator('.hh-today').first().click();
  const modal = page.locator('#modalHabitAction');
  await expect(modal).toHaveClass(/visible/);
  await expect(modal).toContainText('Recaída apuntada');
  await expect(modal.locator('.hla-item')).toHaveCount(2);
  await page.locator('#hlaNote').fill('Miré WhatsApp en el desayuno');
  await page.locator('#hlaCustom').fill('Cargador en el pasillo');
  await modal.getByRole('button', { name: 'Añadir a Hoy y al calendario' }).click();
  await expect(modal).not.toHaveClass(/visible/);

  const stored = await page.evaluate(k => {
    const h = db.habitChallenges.find(x => x.id === 'detox');
    return { status: h.logs[k] && h.logs[k].status, note: h.logs[k] && h.logs[k].note, actions: (h.actions || []).map(a => a.text) };
  }, day(0));
  expect(stored.status).toBe('failed');
  expect(stored.note).toBe('Miré WhatsApp en el desayuno');
  expect(stored.actions).toContain('Cargador en el pasillo');
  expect(stored.actions.length).toBe(3);

  await expect(card).toContainText('Acciones de hoy');
  await expect(card).toContainText('Cargador en el pasillo');

  await page.evaluate(() => showView('calendario'));
  await expect(page.locator('#mv2Cal .mv2-act').first()).toBeVisible();
  await page.evaluate(k => MobileV2.openDay(k), day(0));
  await expect(page.locator('#mv2DaySheet')).toContainText('Cargador en el pasillo');
});
