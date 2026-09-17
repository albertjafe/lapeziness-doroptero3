import { test, expect } from '@playwright/test';

test.use({ hasTouch: true });
async function boot(page, todayCount = 16) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* isolated local history */' }));
  await page.addInitScript(count => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1' });
    if (localStorage.getItem('alberto_piano_v2')) return;
    const at = (days, minute = 0) => { const d = new Date(); d.setDate(d.getDate() - days); d.setHours(8, minute, 0, 0); return d; };
    const plant = (days, i) => ({ id: `${days}-${i}`, runId: `${days}-${i}`, obraId: 'bach', source: i === 0 ? 'manual' : 'app', mins: 20,
      startedAt: at(days, i * 25).toISOString(), endedAt: new Date(at(days, i * 25).getTime() + 20 * 60000).toISOString() });
    const sessionPlants = [...Array.from({ length: count }, (_, i) => plant(0, i)), plant(1, 0), plant(3, 0), plant(8, 0)];
    const sesiones = count ? [{ date: at(0).toISOString(), items: [
      { id: '0-0', studyPlantId: '0-0', obraId: 'bach', manual: true, minutosEstudiados: 20, minutosReales: 20 },
      { id: 'legacy', obraId: 'chopin', obraName: 'Chopin', manual: true, minutosEstudiados: 15, minutosReales: 15, privateField: 'preserve' },
    ] }] : [];
    localStorage.setItem('alberto_piano_v2', JSON.stringify({ obras: [
      { id: 'bach', name: 'Bach', composer: 'Bach', movimientos: [], sol: 50, solHistory: [] },
      { id: 'chopin', name: 'Chopin', composer: 'Chopin', movimientos: [], sol: 50, solHistory: [] },
    ], eventos: [], sesiones, registro: [], forestPlants: count ? [{ ...sessionPlants[0] }] : [], sessionPlants }));
  }, todayCount);
  await page.goto('/');
  await page.waitForFunction(() => window.DailyStudyMinutes && window.saveTimedStudyEdit.__minuteCorrectionWrapped);
  await expect(page.locator('#splashScreen')).toBeHidden();
}

for (const viewport of [{ width: 834, height: 1194 }, { width: 1194, height: 834 }]) {
  test(`registro accesible en Hoy y cronómetro ${viewport.width}: carga por días y edición visible`, async ({ page }, info) => {
    test.setTimeout(45000);
    await page.setViewportSize(viewport); await boot(page);
    await page.getByRole('button', { name: 'Sesiones de hoy' }).click();
    const modal = page.getByRole('dialog', { name: 'Registro de sesiones' });
    await expect(modal).toBeVisible();
    await expect(modal.locator('.sesdet-day')).toHaveCount(1);
    await expect(modal.locator('.sesdet-row')).toHaveCount(17);
    await expect(modal.locator('.sesdet-day-label')).toContainText('Hoy');
    const total = await page.evaluate(() => getMinutosConcentradoHoy());
    expect(total).toBe(335);
    await expect(modal.locator('.sesdet-day-total')).toHaveText(await page.evaluate(total => fmtMinutos(total), total));
    for (let days = 2; days <= 4; days++) {
      await modal.locator('.sesdet-body').evaluate(el => { el.scrollTop = el.scrollHeight; el.dispatchEvent(new Event('scroll')); });
      await expect(modal.locator('.sesdet-day')).toHaveCount(days);
    }
    await expect(modal.locator('.sesdet-more')).toHaveCount(0);
    await modal.getByRole('button', { name: 'Cerrar', exact: true }).click();
    await page.evaluate(() => showView('cronometro'));
    await page.locator('.crono-hours-btn').click();
    await expect(modal.locator('.sesdet-day')).toHaveCount(1);
    await expect(modal.locator('.sesdet-body')).toHaveJSProperty('scrollTop', 0);
    await modal.locator('[data-source="sessionPlants"][data-index="0"]').click();
    const form = modal.locator('.sesdet-edit');
    await expect(form).toBeVisible();
    await expect(form.locator('[data-field="obra"]')).toHaveValue('obra::bach');
    const box = await modal.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y).toBeGreaterThanOrEqual(0); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await form.locator('[data-field="minutes"]').fill('35');
    await page.screenshot({ path: info.outputPath('registro-edicion.png') });
    await form.getByRole('button', { name: 'Guardar' }).click();
    expect(await page.evaluate(() => getMinutosConcentradoHoy())).toBe(350);
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('alberto_piano_v2')));
    expect(stored.sessionPlants.find(p => p.id === '0-0')).toMatchObject({ mins: 35, minuteCorrection: { from: 20, to: 35, source: 'sessions-by-hours' } });
    expect(stored.forestPlants[0].mins).toBe(35);
    expect(stored.sesiones[0].items[0].minutosEstudiados).toBe(35);
    await page.reload(); await page.waitForFunction(() => window.DailyStudyMinutes);
    await page.getByRole('button', { name: 'Sesiones de hoy' }).click();
    expect(await page.evaluate(() => getMinutosConcentradoHoy())).toBe(350);
  });
}

test('registros legados sin hora: edición conservadora y botón de carga si hoy está vacío', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 }); await boot(page);
  await page.getByRole('button', { name: 'Sesiones de hoy' }).click();
  const row = page.locator('.sesdet-row').filter({ hasText: 'Chopin' });
  await expect(row).toContainText('Sin hora');
  await row.getByRole('button', { name: 'Editar sesión' }).click();
  await row.locator('[data-field="minutes"]').fill('45');
  await row.getByRole('button', { name: 'Guardar' }).click();
  expect(await page.evaluate(() => getMinutosConcentradoHoy())).toBe(365);
  expect(await page.evaluate(() => db.sesiones[0].items[1])).toMatchObject({ minutosEstudiados: 45, privateField: 'preserve', historicalEdit: { source: 'sessions-by-hours' } });
  await expect(page.locator('.sesdet-row').filter({ hasText: 'Chopin' })).toContainText('Sin hora');
  await page.evaluate(() => { db.sessionPlants = db.sessionPlants.filter(p => p.id.startsWith('1-')); db.forestPlants = []; db.sesiones = []; openSesionesDetalle(); });
  await expect(page.locator('.sesdet-day')).toHaveCount(1);
  await expect(page.locator('.sesdet-empty')).toContainText('Hoy aún no hay');
  await page.getByRole('button', { name: 'Ver un día anterior' }).click();
  await expect(page.locator('.sesdet-day')).toHaveCount(2);
  await expect(page.locator('.sesdet-row')).toHaveCount(1);
  await page.evaluate(() => {
    openSesionesDetalle();
    const body = document.getElementById('sesionesDetalleBody');
    body.ontouchstart({ touches: [{ clientY: 300 }] });
    body.ontouchend({ changedTouches: [{ clientY: 100 }] });
  });
  await expect(page.locator('.sesdet-day')).toHaveCount(2);
});

test('no modifica otra sesión si el historial cambia durante una edición', async ({ page }) => {
  await boot(page); await page.evaluate(() => openSesionesDetalle());
  await page.locator('[data-source="sessionPlants"][data-index="0"]').click();
  await page.locator('.sesdet-edit [data-field="minutes"]').fill('90');
  await page.evaluate(() => db.sessionPlants.reverse());
  await page.getByRole('button', { name: 'Guardar', exact: true }).click();
  expect(await page.evaluate(() => db.sessionPlants.every(p => p.mins === 20 && !p.historicalEdit))).toBe(true);
  await expect(page.locator('.sesdet-edit')).toHaveCount(0);
});

test('edita un día anterior desde un cronómetro en marcha sin interrumpir el estudio', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 }); await boot(page, 2);
  await page.evaluate(() => { cronoHydrate(); showView('cronometro'); cronoFillObraSelect(); });
  const target = await page.locator('#cronoObraSelect option').evaluateAll(options => options.find(o => o.value === 'obra::bach' || o.value.startsWith('mov::bach::')).value);
  await page.evaluate(value => { document.getElementById('cronoObraSelect').value = value; cronoUpdateStartBtn(); }, target);
  await page.locator('#cronoStartBtn').click();
  await page.locator('.crono-hours-btn').click();
  await page.getByRole('button', { name: 'Ver un día anterior' }).click();
  const yesterday = page.locator('.sesdet-day').nth(1);
  await yesterday.getByRole('button', { name: 'Editar sesión' }).click();
  await yesterday.locator('[data-field="obra"]').selectOption('obra::chopin');
  await yesterday.locator('[data-field="time"]').fill('10:15');
  await yesterday.locator('[data-field="minutes"]').fill('45');
  await yesterday.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.locator('.sesdet-day')).toHaveCount(2);
  await expect(yesterday).toContainText('10:15–11:00');
  await expect(yesterday).toContainText('Chopin');
  expect(await page.evaluate(() => ({ mins: db.sessionPlants.find(p => p.id === '1-0').mins, today: getMinutosConcentradoHoy(), state: crono.state }))).toEqual({ mins: 45, today: 55, state: 'running' });
  await page.getByRole('button', { name: 'Cerrar', exact: true }).focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('#modalSesionesDetalle')).toBeHidden();
  await expect(page.locator('.crono-hours-btn')).toBeFocused();
});

test('conserva el total canónico al redondear y al editar un registro con espejos', async ({ page }) => {
  await boot(page, 2);
  await page.evaluate(() => {
    db.sessionPlants[0].mins = 20.2; db.sessionPlants[1].mins = 20.2;
    db.forestPlants = [];
    db.sesiones[0].items[0].minutosEstudiados = db.sesiones[0].items[0].minutosReales = 20.2;
    db.sesiones[0].items.push({ ...db.sesiones[0].items[1], privateField: 'mirror' });
    openSesionesDetalle();
  });
  await expect(page.locator('.sesdet-row')).toHaveCount(3);
  expect(await page.evaluate(() => [...document.querySelectorAll('.sesdet-min')].reduce((sum, el) => sum + parseFloat(el.textContent), 0))).toBe(await page.evaluate(() => getMinutosConcentradoHoy()));
  const row = page.locator('.sesdet-row').filter({ hasText: 'Chopin' });
  await row.getByRole('button', { name: 'Editar sesión' }).click();
  await row.locator('[data-field="minutes"]').fill('30');
  await row.getByRole('button', { name: 'Guardar' }).click();
  const mirrors = await page.evaluate(() => db.sesiones[0].items.filter(p => p.id === 'legacy').map(p => p.minutosEstudiados));
  expect(mirrors.length).toBeGreaterThan(0);
  expect(mirrors.every(mins => mins === 30)).toBe(true);
  expect(await page.evaluate(() => getMinutosConcentradoHoy())).toBe(70);
});
