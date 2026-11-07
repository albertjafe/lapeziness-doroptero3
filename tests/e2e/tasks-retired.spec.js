import { test, expect } from '@playwright/test';

// Nov 2026: las tareas se escriben en el diario («-» hoy, «+» otro día). La
// lista de la app (db.cronoTasks) se conserva, pero ya no se ve ni se ofrece.
test('las tareas de la app ya no aparecen en Hoy, en la mesa de trabajo ni al guardar un bloque', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const today = new Date().toISOString().slice(0, 10);
  await page.addInitScript(data => {
    localStorage.setItem('alberto_mobile_design', 'v2');
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
  }, { competitionPlanningSeedVersion: 999, obras: [{ id: 'w', name: 'Waldstein', movimientos: [] }], eventos: [], sesiones: [], sessionPlants: [], forestPlants: [], registro: [],
    cronoTasks: [{ id: 't', text: 'Llamar al casero', done: false, dueDate: today, createdAt: today, updatedAt: today }] });
  await page.goto('/');
  await page.waitForFunction(() => window.MobileV2 && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
  await expect(page.locator('#mv2Hoy .mv2-summary')).toBeVisible();
  await expect(page.locator('#mv2Hoy')).not.toContainText('Llamar al casero');
  await expect(page.locator('#tdInput')).toHaveCount(0);
  await page.evaluate(() => showView('cronometro'));
  const drawer = page.locator('#cronoIdleDrawer');
  await expect(drawer.getByRole('tab', { name: /Tareas/ })).toHaveCount(0);
  await expect(drawer).toHaveAttribute('data-tab', 'pasajes');
  // Los datos no se tocan.
  expect(await page.evaluate(() => db.cronoTasks.map(t => t.text))).toEqual(['Llamar al casero']);
});
