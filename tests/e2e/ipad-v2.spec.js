// Diseño v2 en el iPad (html.mv2-tablet): Hoy, cronómetro y calendario a lo
// ancho, cabecera limpia y gesto lateral sin diferencias entre vista previa y
// pantalla final. El diseño clásico del iPad sigue en ipad-today / view-swipe-ipad.
import { test, expect } from '@playwright/test';

const ipadUA = 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
test.use({ userAgent: ipadUA, hasTouch: true });

const day = k => { const d = new Date(); d.setDate(d.getDate() - k); return d; };
const fixture = () => ({
  competitionPlanningSeedVersion: 999,
  obras: [
    { id: 'b', name: 'Partita nº 2', composer: 'Bach', movimientos: [{ id: 'cap', name: 'Capriccio', solHistory: [] }] },
    { id: 'c', name: 'Balada nº 1', composer: 'Chopin', movimientos: [], solHistory: [{ date: day(2).toISOString(), val: 55 }] },
  ],
  eventos: [{ id: 'e', nombre: 'Recital de otoño en el auditorio principal del conservatorio', tipo: 'concierto', fecha: day(-9).toISOString().slice(0, 10), obras: ['b', 'c'] }],
  sessionPlants: [{ id: 'p', obraId: 'c', mins: 50, startedAt: day(1).toISOString(), endedAt: day(1).toISOString() }],
  sesiones: [], forestPlants: [], registro: [],
});

async function boot(page, viewport) {
  await page.setViewportSize(viewport);
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.addInitScript(data => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
  }, fixture());
  await page.goto('/');
  await page.waitForFunction(() => window.MobileV2 && typeof showView === 'function' && typeof initViewSwipeNavigation === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
}

async function touch(page, type, x, y = 420) {
  await page.evaluate(({ type, x, y }) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const point = { identifier: 1, clientX: x, clientY: y };
    Object.defineProperties(event, { touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] }, changedTouches: { value: [point] } });
    document.querySelector('.view.active').dispatchEvent(event);
  }, { type, x, y });
}
// Consulta y mide en el mismo paso: Hoy se repinta entero cuando llegan las
// prioridades del Profesor y un nodo recién sustituido mediría 0.
const box = (page, selector) => page.evaluate(sel => { const r = document.querySelector(sel).getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }; }, selector);
const settledHoy = page => expect(page.locator('#mv2Hoy .mv2-parahoy')).not.toContainText('Calculando', { timeout: 15000 });

for (const viewport of [{ width: 834, height: 1194 }, { width: 1194, height: 834 }]) {
  const wide = viewport.width > 1000;

  test(`iPad ${viewport.width}: Hoy v2 a lo ancho, sin la portada clásica`, async ({ page }) => {
    await boot(page, viewport);
    await expect(page.locator('html')).toHaveClass(/mv2-on/);
    await expect(page.locator('html')).toHaveClass(/mv2-tablet/);
    await expect(page.locator('#mv2Hoy .mv2-summary')).toBeVisible();
    await settledHoy(page);
    await expect(page.locator('#sessionResumenCard')).toBeHidden();
    await expect(page.locator('.ipad-today-next')).toBeHidden();
    // En el iPad caben Aulas y Profesor en la barra: los accesos de Hoy son Alemán, Premios e Historial.
    await expect(page.locator('#mv2Hoy .mv2-tile', { hasText: 'Historial' })).toBeVisible();
    await expect(page.locator('#mv2Hoy .mv2-tile', { hasText: 'Profesor' })).toHaveCount(0);
    await expect(page.locator('#mv2Hoy .mv2-habits')).toBeVisible();
    const main = await box(page, '#mv2Hoy .mv2-col-main');
    const side = await box(page, '#mv2Hoy .mv2-col-side');
    if (wide) expect(side.x).toBeGreaterThan(main.x + main.width - 1); // dos columnas
    else expect(side.y).toBeGreaterThan(main.y + main.height - 1); // una debajo de otra
    // Cabecera: sin botón Aulas repetido; el próximo evento con sus días a la vista.
    await expect(page.locator('.header-actions .piano-rooms-open')).toBeHidden();
    await expect(page.locator('#packNameHeader .header-event-days')).toHaveText('9 d');
    await page.evaluate(() => showView('obras'));
    await expect(page.locator('#packNameHeader')).toBeHidden();
  });

  test(`iPad ${viewport.width}: cronómetro centrado, anillo grande, chips y mesa como hoja`, async ({ page }) => {
    await boot(page, viewport);
    await page.evaluate(() => {
      showView('cronometro');
      const sel = document.getElementById('cronoObraSelect');
      if (typeof cronoFillObraSelect === 'function') cronoFillObraSelect();
      sel.value = [...sel.options].find(o => o.value).value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(page.locator('#cronoCalendarObjectivesShell')).toBeHidden();
    await expect(page.locator('#cronoActivitySelector .crono-activity-tabs')).toBeVisible();
    await expect(page.locator('#cronoActivityType')).toHaveCount(0);
    const ring = await box(page, '#cronoIdleDisplayWrap');
    expect(ring.width).toBeGreaterThanOrEqual(wide ? 270 : 380);
    expect(Math.abs(ring.x + ring.width / 2 - viewport.width / 2)).toBeLessThan(4);
    const start = await box(page, '#cronoStartBtn');
    const sheet = await box(page, '#cronoIdleDrawer');
    expect(start.y + start.height).toBeLessThanOrEqual(sheet.y);
    expect(sheet.y + sheet.height).toBe(viewport.height); // pegada abajo: en el crono no hay barra
    await page.locator('#cronoIdleDrawer').getByRole('tab', { name: /Pasajes/ }).click();
    await expect(page.locator('#cronoIdleDrawer')).toHaveClass(/mv2-sheet-open/);
    await page.locator('#cronoStartBtn').evaluate(b => b.click());
    await expect.poll(() => page.evaluate(() => crono.state)).toBe('running');
    await expect(page.getByRole('button', { name: 'Terminar', exact: true })).toBeVisible();
  });

  test(`iPad ${viewport.width}: el gesto lateral muestra Hoy tal y como queda al llegar`, async ({ page }) => {
    await boot(page, viewport);
    await settledHoy(page);
    const expected = await box(page, '#mv2Hoy .mv2-summary');
    await page.evaluate(() => showView('cronometro'));
    await touch(page, 'touchstart', 150);
    await touch(page, 'touchmove', viewport.width / 2);
    await expect(page.locator('body')).toHaveClass(/view-swipe-dragging/);
    const preview = await box(page, '#mv2Hoy .mv2-summary');
    expect(preview.y).toBe(expected.y);
    expect(preview.width).toBe(expected.width);
    expect(preview.height).toBe(expected.height);
    await touch(page, 'touchmove', viewport.width - 30);
    await touch(page, 'touchend', viewport.width - 30);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'session');
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    expect(await box(page, '#mv2Hoy .mv2-summary')).toEqual(expected);
  });

  test(`iPad ${viewport.width}: calendario v2 y el gesto no lo vuelve a pintar al llegar`, async ({ page }) => {
    await boot(page, viewport);
    await page.evaluate(() => showView('obras'));
    await touch(page, 'touchstart', viewport.width - 150);
    await touch(page, 'touchmove', viewport.width / 2);
    await expect(page.locator('#mv2Cal .mv2-cal-grid')).toBeVisible();
    // Marca el contenido de la vista previa: si al llegar se repintara, se perdería.
    await page.evaluate(() => { document.querySelector('#mv2Cal .mv2-card').dataset.preview = '1'; });
    await touch(page, 'touchmove', 30);
    await touch(page, 'touchend', 30);
    await expect(page.locator('body')).toHaveAttribute('data-view', 'calendario');
    await expect(page.locator('body')).not.toHaveClass(/view-swipe-settling/);
    await expect(page.locator('#mv2Cal .mv2-card[data-preview="1"]')).toHaveCount(1);
    const days = await box(page, '#mv2Cal .mv2-day');
    expect(days.height).toBeLessThan(80); // casillas bajas, no cuadradas de 100 px
    if (wide) expect((await box(page, '#mv2Cal > .mv2-card:nth-child(2)')).x).toBeGreaterThan((await box(page, '#mv2Cal > .mv2-card')).x + 100);
  });
}

test('iPad: «Clásico» devuelve la portada anterior del iPad', async ({ page }) => {
  await boot(page, { width: 834, height: 1194 });
  await page.evaluate(() => { openSettings(); });
  await expect(page.locator('#mv2DesignRow')).toBeVisible();
  await page.locator('#mv2DesignRow').getByRole('button', { name: 'Clásico', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/mv2-on/);
  await page.evaluate(() => showView('session'));
  await expect(page.locator('#sessionResumenCard')).toBeVisible();
  await expect(page.locator('#mv2Hoy')).toBeHidden();
});
