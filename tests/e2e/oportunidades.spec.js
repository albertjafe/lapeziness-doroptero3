import { test, expect } from '@playwright/test';

// Oportunidades: pestañas Festivales/Becas con el dosier inicial y Seguimiento
// de contactos (ayuntamientos). Reloj fijo en el 3-10-2026.
const fixture = {
  obras: [{ id: 'o1', name: 'Bach · Partita 2', composer: 'J. S. Bach', tipo: 'obra', movimientos: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  competitionPlanningSeedVersion: 1,
};

async function prepare(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date('2026-10-03T10:00:00'));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(data => {
    if (!localStorage.getItem('oportunidades_test_seed')) {
      localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
      localStorage.setItem('oportunidades_test_seed', '1');
    }
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.Oportunidades && window.ConcursosDossier);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} });
}

test('festivales, becas y seguimiento: fichas, añadir contacto y avanzar estados', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.getByRole('button', { name: 'Oportunidades', exact: true }).click();
  const view = page.locator('#view-concursos');
  const tabs = view.locator('#opTabs');
  await expect(tabs.getByRole('tab')).toHaveText([/^Concursos/, /^Festivales/, /^Becas/, /^Seguimiento/]);
  await expect(view.locator('#cdPanel .cd-card')).not.toHaveCount(0);

  // Festivales: el dosier inicial se carga y lo primero es el plazo que antes cierra.
  await tabs.getByRole('tab', { name: /^Festivales/ }).click();
  await expect(view.locator('#cdPanel')).toBeHidden();
  const panel = view.locator('#opPanel');
  await expect(panel.locator('.cd-card')).not.toHaveCount(0);
  await expect(panel.locator('.cd-card').first()).toContainText('AIEnRUTa-Clásicos');
  await expect(panel.locator('.cd-card').first()).toContainText('Cierra en 25 días');
  expect(await page.evaluate(() => db.oportunidades.fichas.length)).toBeGreaterThanOrEqual(10);

  // Abrir la ficha y pasarla a Seguimiento.
  const first = panel.locator('.cd-card').first();
  await first.locator('summary').click();
  await expect(first.locator('.cd-detail')).toContainText('Cómo se entra');
  await first.getByRole('button', { name: 'Añadir a seguimiento' }).click();
  await expect(panel.locator('#opMessage')).toContainText('Por contactar');
  await expect(panel.locator('.cd-card').first()).toContainText('En seguimiento');

  // Becas.
  await tabs.getByRole('tab', { name: /^Becas/ }).click();
  await expect(panel.locator('.cd-card')).not.toHaveCount(0);
  await expect(panel).toContainText('Mozarteum');

  // Seguimiento: la ficha está y se añaden los ayuntamientos sugeridos.
  await tabs.getByRole('tab', { name: /^Seguimiento/ }).click();
  const table = panel.locator('.op-table');
  await expect(table.locator('tr.op-row')).toHaveCount(1);
  await panel.locator('.op-suggest button').click();
  await expect(table.locator('tr.op-row')).toHaveCount(9);
  await expect(panel.locator('.op-suggest')).toHaveCount(0);

  // Alta manual con email.
  await panel.locator('.op-add > summary').click();
  await panel.locator('#opNew-nombre').fill('Ayuntamiento de Almagro');
  await panel.locator('#opNew-email').fill('cultura@example.org');
  await panel.getByRole('button', { name: 'Añadir', exact: true }).click();
  const almagro = table.locator('tr.op-row', { hasText: 'Ayuntamiento de Almagro' });
  await expect(almagro).toContainText('Enviar el email');

  // Email enviado → espera hasta dentro de 7 días.
  await almagro.getByRole('button', { name: 'Email enviado hoy' }).click();
  await expect(almagro).toContainText('Esperar respuesta hasta el 10 oct');
  const saved = await page.evaluate(() => db.oportunidades.contactos.find(c => c.nombre === 'Ayuntamiento de Almagro'));
  expect(saved).toMatchObject({ estado: 'enviado', enviado: '2026-10-03', proximo: '2026-10-10' });

  // Editar y archivar (nunca se borra).
  await almagro.getByRole('button', { name: 'Editar' }).click();
  await panel.locator('#opEdit-persona').fill('Técnico de Cultura');
  await panel.getByRole('button', { name: 'Guardar' }).click();
  await expect(almagro).toContainText('Técnico de Cultura');
  await almagro.getByRole('button', { name: 'Archivar' }).click();
  await expect(table.locator('tr.op-row', { hasText: 'Ayuntamiento de Almagro' })).toHaveCount(0);
  await panel.getByRole('tab', { name: /^Archivo/ }).click();
  await expect(panel.locator('tr.op-row', { hasText: 'Ayuntamiento de Almagro' })).toHaveCount(1);
  expect(await page.evaluate(() => db.oportunidades.contactos.length)).toBe(10);

  // La pestaña se recuerda y todo sobrevive a recargar.
  await page.reload();
  await page.waitForFunction(() => window.Oportunidades);
  await page.evaluate(() => showView('concursos'));
  await expect(page.locator('#opTabs').getByRole('tab', { name: /^Seguimiento/ })).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => db.oportunidades.contactos.find(c => c.nombre === 'Ayuntamiento de Almagro').persona)).toBe('Técnico de Cultura');
  expect(errors).toEqual([]);
});

test('móvil: pestañas y seguimiento caben sin scroll lateral', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 });
  await page.locator('.mv2-tile:has-text("Oportunidades")').first().click();
  const view = page.locator('#view-concursos');
  await view.locator('#opTabs').getByRole('tab', { name: /^Seguimiento/ }).click();
  await view.locator('.op-suggest button').click();
  await expect(view.locator('tr.op-row')).toHaveCount(8);
  await view.locator('tr.op-row').first().getByRole('button', { name: 'Editar' }).click();
  await expect(view.locator('#opEdit-nombre')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await view.locator('#opTabs').getByRole('tab', { name: /^Festivales/ }).click();
  await view.locator('#opPanel .cd-card').first().locator('summary').click();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2).toBeLessThanOrEqual(1);
});
