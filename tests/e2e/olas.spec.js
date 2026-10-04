import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'], defaultBrowserType: undefined });

const keyOf = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const daysAgo = k => { const d = new Date(); d.setDate(d.getDate() - k); d.setHours(11, 0, 0, 0); return d; };

async function boot(page, extra = {}) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  const data = { competitionPlanningSeedVersion: 999, obras: [], eventos: [], sessionPlants: [], sesiones: [], forestPlants: [], registro: [], ...extra };
  await page.addInitScript(d => { if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(d)); }, data);
  await page.goto('/');
  await page.waitForFunction(() => window.MobileV2 && window.Olas && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
}

test('Olas: un toque en Hoy anota la ola, sin contador; Deshacer la quita y todo se guarda', async ({ page }) => {
  await boot(page);
  const button = page.locator('#mv2Hoy .mv2-ola');
  await expect(button).toBeVisible();
  await expect(button).toHaveText('Ola');
  await expect(button).toHaveAttribute('data-level', '0');
  await button.click();
  await expect(page.locator('#undoToast')).toHaveClass(/visible/);
  await expect(page.locator('#undoToastMsg')).toHaveText('Ola anotada');
  await expect(button).toHaveAttribute('data-level', '1');
  await button.click();
  await expect(page.locator('#undoToastMsg')).toHaveText('Ola anotada · fuerte');
  // Mientras dura la ola, el botón enseña la intensidad que se anota (crestas y color),
  // no un recuento del día; la palabra no cambia.
  await expect(button).toHaveText('Ola');
  await expect(button).toHaveAttribute('data-level', '2');
  await expect(button).toHaveAttribute('aria-label', 'Anotar una ola (ahora: fuerte)');
  expect(await page.evaluate(() => db.olas.length)).toBe(2);
  // Si Hoy se repinta a mitad de la ola, la intensidad se conserva.
  await page.evaluate(() => { const h = document.getElementById('mv2Hoy'); h.__mv2Html = ''; MobileV2.renderHoy && MobileV2.renderHoy(); });
  await expect(page.locator('#mv2Hoy .mv2-ola')).toHaveAttribute('data-level', '2');
  // Deshacer quita el último toque (lo marca, no lo borra) y el botón vuelve a la calma.
  await page.locator('#undoToastBtn').click();
  await expect(button).toHaveAttribute('data-level', '0');
  expect(await page.evaluate(() => db.olas.map(t => !!t.undone))).toEqual([false, true]);
  const today = keyOf(new Date());
  expect(await page.evaluate(k => Olas.loadByDay(db)[k], today)).toBe(1);
  // Guardado en el dispositivo.
  await expect.poll(() => page.evaluate(() => (JSON.parse(localStorage.getItem('alberto_piano_v2') || '{}').olas || []).length)).toBe(2);
});

test('Olas: la capa del calendario distingue días tranquilos, olas y días sin registro', async ({ page }) => {
  const at = (k, s = 0) => { const d = daysAgo(k); d.setSeconds(s); return d.toISOString(); };
  // Hace 3 días: primera ola (dos toques seguidos = carga 2). Hace 2: tranquilo. Ayer: 3 olas fuertes (carga 9).
  const olas = [
    { id: 'a', at: at(3, 0) }, { id: 'b', at: at(3, 4) },
    ...[0, 1, 2].flatMap(w => [0, 3, 6].map(s => ({ id: 'y' + w + s, at: new Date(daysAgo(1).getTime() + w * 3600000 + s * 1000).toISOString() }))),
  ];
  await boot(page, { olas });
  await page.evaluate(() => { localStorage.removeItem('alberto_cal_layer'); showView('calendario'); });
  const cal = page.locator('#mv2Cal');
  await expect(cal).toBeVisible();
  await expect(cal.locator('.mv2-cal-layers button.is-on')).toHaveText('Horas');
  await cal.getByRole('button', { name: 'Olas', exact: true }).click();
  await expect(cal.locator('.mv2-cal-layers button.is-on')).toHaveText('Olas');
  await expect(cal.locator('.mv2-legend')).toContainText('Tranquilo');
  const cell = async k => {
    const key = keyOf(daysAgo(k));
    if (!(await cal.locator(`.mv2-day[data-day="${key}"]`).count())) await cal.getByRole('button', { name: 'Mes anterior' }).click();
    return cal.locator(`.mv2-day[data-day="${key}"]`).first();
  };
  // Se recuerda por dispositivo.
  expect(await page.evaluate(() => localStorage.getItem('alberto_cal_layer'))).toBe('olas');
  await expect(await cell(4)).toHaveClass(/\bnone\b/); // antes del primer toque
  await expect(await cell(3)).toHaveClass(/\bo1\b/);   // carga 2
  await expect(await cell(2)).toHaveClass(/\bo0\b/);   // tranquilo
  await expect(await cell(1)).toHaveClass(/\bo4\b/);   // carga 9
  // La hoja del día enseña cada ola con su hora e intensidad.
  await (await cell(1)).click();
  await expect(page.locator('#mv2DaySheet')).toContainText('Olas:');
  await expect(page.locator('#mv2DaySheet')).toContainText('×3');
  await page.locator('#mv2DaySheet').getByRole('button', { name: 'Cerrar' }).click();
  // Volver a Horas restaura el mapa de siempre.
  await cal.getByRole('button', { name: 'Horas', exact: true }).click();
  await expect(cal.locator('.mv2-legend')).toContainText('5 h+');
});
