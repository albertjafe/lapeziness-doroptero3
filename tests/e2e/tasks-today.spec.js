import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'], defaultBrowserType: undefined });

const dayKey = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

async function boot(page, tasks) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const data = { competitionPlanningSeedVersion: 999, obras: [], eventos: [], sessionPlants: [], sesiones: [], forestPlants: [], registro: [], cronoTasks: tasks };
  await page.addInitScript(d => { if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(d)); }, data);
  await page.goto('/');
  await page.waitForFunction(() => window.MobileV2 && window.TasksToday && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
}

test('Tareas de hoy: apuntar con fecha, elegir para hoy, hacer y pasar a mañana', async ({ page }) => {
  const old = new Date(Date.now() - 20 * 86400000).toISOString();
  await boot(page, [
    { id: 't_late', text: 'Llamar al casero', kind: 'personal', priority: 2, done: false, dueDate: dayKey(-2), createdAt: old, updatedAt: old },
    { id: 't_list', text: 'Arreglar persiana', kind: 'personal', priority: 0, done: false, createdAt: old, updatedAt: old },
  ]);
  const card = page.locator('#mv2Hoy .td-card');
  await expect(card).toContainText('Llamar al casero');
  await expect(card).toContainText('atrasada');
  await expect(card).not.toContainText('Arreglar persiana');

  // Escribir con fecha: va a ese día y no a hoy.
  await card.locator('#tdInput').fill('Comprar cuerdas mañana');
  await card.locator('#tdInput').press('Enter');
  await expect(page.locator('#toast')).toContainText('mañana');
  const added = await page.evaluate(() => db.cronoTasks.find(t => t.text === 'Comprar cuerdas'));
  expect(added.dueDate).not.toBeNull();
  await expect(card).not.toContainText('Comprar cuerdas');

  // Sin fecha y con hueco: para hoy.
  await card.locator('#tdInput').fill('Escribir a Fernando');
  await card.getByRole('button', { name: 'Apuntar tarea' }).click();
  await expect(card).toContainText('Escribir a Fernando');

  // Elegir para hoy desde la lista.
  await card.getByRole('button', { name: 'Elegir para hoy ›' }).click();
  const pick = page.locator('#tdPickSheet');
  await expect(pick).toHaveClass(/open/);
  await pick.getByRole('button', { name: /Arreglar persiana/ }).click();
  await expect(pick).not.toHaveClass(/open/); // con tres ya no deja elegir más
  await expect(card).toContainText('Arreglar persiana');
  await expect(card.getByRole('button', { name: 'Elegir para hoy ›' })).toHaveCount(0);

  // Hecha y pasar a mañana.
  await card.getByRole('button', { name: 'Hecha: Llamar al casero' }).click();
  await expect.poll(() => page.evaluate(() => db.cronoTasks.find(t => t.id === 't_late').done)).toBe(true);
  await card.getByRole('button', { name: 'Pasar a mañana: Arreglar persiana' }).click();
  await expect(card).not.toContainText('Arreglar persiana');
  expect(await page.evaluate(k => db.cronoTasks.find(t => t.id === 't_list').dueDate, dayKey(1))).toBe(dayKey(1));
  // Los cambios llevan fecha de edición: la fusión de tareas gana por la más reciente.
  expect(await page.evaluate(() => Date.parse(db.cronoTasks.find(t => t.id === 't_list').updatedAt) > Date.now() - 60000)).toBe(true);
});

test('Tareas de hoy: lo que escribes no se pierde cuando Hoy se repinta', async ({ page }) => {
  await boot(page, []);
  const input = page.locator('#tdInput');
  await input.fill('Medio escrito');
  await page.evaluate(() => { const host = document.getElementById('mv2Hoy'); host.__mv2Html = ''; MobileV2.renderHoy(); });
  await expect(page.locator('#tdInput')).toHaveValue('Medio escrito');
});

test('Repaso: las tareas antiguas sin fecha salen una a una (Hoy, Esta semana, Borrar)', async ({ page }) => {
  const old = new Date(Date.now() - 30 * 86400000).toISOString();
  await boot(page, [
    { id: 'r1', text: 'Tarea vieja uno', kind: 'personal', priority: 0, done: false, createdAt: old, updatedAt: old },
    { id: 'r2', text: 'Tarea vieja dos', kind: 'personal', priority: 0, done: false, createdAt: old, updatedAt: old },
  ]);
  await page.evaluate(() => TasksToday.openReview());
  const sheet = page.locator('#tdReviewSheet');
  await expect(sheet).toContainText('Tarea vieja uno');
  await sheet.getByRole('button', { name: 'Borrar' }).click();
  await expect(sheet).toContainText('Tarea vieja dos');
  await sheet.getByRole('button', { name: 'Hoy' }).click();
  await expect(sheet).toContainText('Repaso hecho');
  const state = await page.evaluate(() => ({ ids: db.cronoTasks.map(t => t.id), tomb: (db.cronoTaskTombstones || []).map(t => t.id) }));
  expect(state.ids).toEqual(['r2']);
  expect(state.tomb).toContain('r1');
});
