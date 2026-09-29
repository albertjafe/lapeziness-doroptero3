import { test, expect } from '@playwright/test';

const obra = (id, name, composer, extra = {}) => ({ id, name, composer, dificultad: 5, duracion: 8, solHistory: [], ...extra });
const data = {
  obras: [
    obra('o_bach', 'Partita n.º 2', 'Bach'),
    obra('o_chopin', 'Balada n.º 1', 'Chopin'),
    obra('o_ravel', 'Ondine', 'Ravel'),
    obra('o_liszt', 'Sonata en si menor', 'Liszt'),
    obra('o_beet', 'Sonata op. 110', 'Beethoven', { movimientos: [{ id: 'm1', name: 'Moderato cantabile' }, { id: 'm2', name: 'Fuga' }] }),
  ],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
};

async function prepare(page) {
  await page.setViewportSize({ width: 1024, height: 1366 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* isolated */' }));
  await page.addInitScript(value => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(value));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    // La obra usada más recientemente aparece la primera en el selector.
    localStorage.setItem('cronoPickRecency', JSON.stringify({ o_ravel: Date.now() }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ObraSelectPicker && window.openSesionManual);
}

test('manual study picks the work with search, recent first, above the register window', async ({ page }) => {
  await prepare(page);
  const order = await page.evaluate(() => db.obras.map(o => o.id));
  // Abrir antes el selector desde el cronómetro no debe dejarlo debajo luego.
  await page.evaluate(() => { openCronoObraPicker(); closeCronoObraPicker(); });
  await page.evaluate(() => openSesionManual());
  await expect(page.locator('#modalStudyRegister')).toHaveClass(/visible/);

  const button = page.locator('.obra-pick-btn[data-for="studyRegisterObra"]');
  await expect(button).toBeVisible();
  await expect(button).toHaveText(/Elige obra o movimiento/);
  await button.click();

  const picker = page.locator('#modalCronoObraPicker');
  await expect(picker).toHaveClass(/visible/);
  // Encima de la ventana de registro, no tapado por ella.
  const onTop = await page.evaluate(() => {
    const list = document.getElementById('cronoObraPickerList').getBoundingClientRect();
    const hit = document.elementFromPoint(list.left + list.width / 2, list.top + 20);
    return !!hit && !!hit.closest('#modalCronoObraPicker');
  });
  expect(onTop).toBe(true);
  await expect(picker.locator('.crono-picker-item').first()).toContainText('Ondine');

  await page.locator('#cronoObraPickerSearch').fill('fuga');
  await expect(picker.locator('button.crono-picker-item')).toHaveCount(1);
  await picker.getByRole('button', { name: 'Fuga', exact: true }).click();
  await expect(picker).not.toHaveClass(/visible/);
  await expect(page.locator('#studyRegisterObra')).toHaveValue('mov::o_beet::m2');
  await expect(button).toHaveText(/Sonata op\. 110 · Fuga/);

  await page.locator('#studyMinutePresets [data-minutes="25"]').click();
  await page.locator('#studyRegisterSaveBtn').click();
  await expect(page.locator('#modalStudyRegister')).not.toHaveClass(/visible/);
  const saved = await page.evaluate(() => db.sessionPlants.map(p => [p.obraId, p.movId || null, p.mins]));
  expect(saved).toEqual([['o_beet', 'm2', 25]]);
  // Rellenar el desplegable ya no reordena el repertorio guardado.
  expect(await page.evaluate(() => db.obras.map(o => o.id))).toEqual(order);
});

test('every obra dropdown gets the search picker and keeps its value in sync', async ({ page }) => {
  await prepare(page);
  const ids = await page.evaluate(() => ObraSelectPicker.IDS.filter(id => document.getElementById(id)));
  for (const id of ids) await expect(page.locator('.obra-pick-btn[data-for="' + id + '"]')).toHaveCount(1);
  await page.evaluate(() => openSesionManual());
  // Un valor puesto por código se refleja en el botón.
  await page.locator('#studyRegisterObra').selectOption('obra::o_chopin');
  await expect(page.locator('.obra-pick-btn[data-for="studyRegisterObra"]')).toHaveText(/Balada n\.º 1/);
});
