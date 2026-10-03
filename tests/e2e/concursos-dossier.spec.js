import { test, expect } from '@playwright/test';

// Concursos: dosier inicial, edad, filtros, plan, importación e instrucciones IA.
// El reloj queda fijo en el 2-10-2026 para que los plazos no caduquen.
const fixture = {
  // Con una obra la instalación no está «vacía» y no aparece el aviso de conectar cuenta.
  obras: [{ id: 'o1', name: 'Bach · Partita 2', composer: 'J. S. Bach', tipo: 'obra', movimientos: [] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  competitionPlanningSeedVersion: 1,
};

async function prepare(page, viewport) {
  if (viewport) await page.setViewportSize(viewport);
  await page.clock.setFixedTime(new Date('2026-10-02T10:00:00'));
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(data => {
    if (!localStorage.getItem('concursos_test_seed')) {
      localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
      localStorage.setItem('concursos_test_seed', '1');
    }
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.ConcursosDossier && window.EventPlanning && window.EventPlanning.importDossierEntry);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} });
}

test('dosier de concursos: edad, plazos, plan, importar y sincronización del estado', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.getByRole('button', { name: 'Oportunidades', exact: true }).click();
  const view = page.locator('#view-concursos');
  await expect(view.getByRole('tab', { name: /^Concursos/ })).toHaveAttribute('aria-selected', 'true');
  await expect(view.locator('.cd-card')).not.toHaveCount(0);
  await expect(view.locator('.cd-profile')).toContainText('Tienes 27 años');
  expect(await page.evaluate(() => db.perfil.fechaNacimiento)).toBe('1999-02-19');
  expect(await page.evaluate(() => db.concursosDosier.concursos.length)).toBe(24);

  // Lo primero, el plazo que antes cierra.
  await expect(view.locator('.cd-card').first()).toContainText(/German Piano Award|Campillos/);
  await expect(view.locator('.cd-card').first()).toContainText('Cierra en 13 días');

  const canals = view.locator('.cd-card[data-id="maria-canals-2027"]');
  await expect(canals).toContainText('Elegible');
  await canals.locator('summary').click();
  await expect(canals.locator('.cd-detail')).toContainText('Tendrás 27 años el 1 ene 2027');
  await expect(canals.locator('.cd-rounds > li')).toHaveCount(4);
  await expect(canals.locator('.cd-prizes')).toContainText('25.000');
  await expect(canals.locator('.cd-sources a').first()).toHaveAttribute('href', /mariacanals\.org/);

  await canals.getByRole('button', { name: 'Añadir a mi plan' }).click();
  await expect(view.locator('#cdMessage')).toContainText('está en tu plan');
  const linked = await page.evaluate(() => db.eventos.filter(ev => String(ev.planSourceId || ev.parentSourceId || '').endsWith(':maria-canals-2027')).map(ev => ({ fecha: ev.fecha, hito: !!ev.esHito, estado: ev.estado })));
  expect(linked).toEqual(expect.arrayContaining([{ fecha: '2027-03-07', hito: false, estado: 'standby' }, { fecha: '2026-11-23', hito: true, estado: 'standby' }]));
  await expect(view.locator('.cd-card[data-id="maria-canals-2027"]')).toContainText('En tu plan');

  // Con otra fecha de nacimiento, Maria Canals (17–29 a 1-01-2027) sale de «Para mí».
  await view.locator('#cdBirth').fill('1990-05-01');
  await view.locator('#cdBirth').dispatchEvent('change');
  await expect(view.locator('.cd-card[data-id="maria-canals-2027"]')).toHaveCount(0);
  await view.getByRole('tab', { name: /Todos/ }).click();
  await expect(view.locator('.cd-card[data-id="maria-canals-2027"]')).toContainText('Fuera de edad');
  await view.getByRole('tab', { name: /Archivo/ }).click();
  await expect(view.locator('.cd-card[data-id="istanbul-orchestrasion-2026"]')).toContainText('Plazo cerrado');

  // Importar: una ficha nueva y una actualizada.
  const fresh = { id: 'prueba-2027', nombre: 'Concurso de Prueba', fechas: { inicio: '2027-05-01', fin: '2027-05-05' }, plazo: { fecha: '2027-01-15' }, edad: { sinLimite: true }, fuentes: [{ titulo: 'Bases', url: 'https://example.org/bases', consultado: '2026-10-02' }], verificado: '2026-10-02' };
  const leeds = await page.evaluate(() => JSON.parse(db.concursosDosier.concursos.find(r => r.id === 'leeds-2027').ficha));
  leeds.premiosNota = 'Actualizado por la IA';
  await view.locator('#cdImport').setInputFiles({ name: 'dosier.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ formato: 'dosier-concursos-piano', version: 1, concursos: [fresh, leeds] })) });
  await expect(view.locator('#cdMessage')).toContainText('1 nuevo, 1 actualizado');
  await view.getByRole('tab', { name: /Todos/ }).click();
  await expect(view.locator('.cd-card[data-id="prueba-2027"]')).toContainText('Sin límite de edad');

  // Me interesa / descartar sobreviven a una reimportación.
  const card = view.locator('.cd-card[data-id="prueba-2027"]');
  await card.locator('summary').click();
  await card.getByRole('button', { name: '★ Me interesa' }).click();
  await expect(view.locator('.cd-card[data-id="prueba-2027"]')).toContainText('★ Me interesa');

  await view.getByRole('button', { name: 'Instrucciones para la IA' }).click();
  await expect(page.locator('#cdAiDialog')).toBeVisible();
  await expect(page.locator('#cdAiDialog textarea')).toHaveValue(/dosier-concursos-piano/);
  await page.locator('#cdAiDialog').getByRole('button', { name: 'Cerrar' }).click();

  // Todo vive en el documento sincronizado y sobrevive a recargar.
  await page.reload();
  await page.waitForFunction(() => window.ConcursosDossier);
  await page.evaluate(() => showView('concursos'));
  await expect(page.locator('#view-concursos .cd-profile input')).toHaveValue('1990-05-01');
  expect(await page.evaluate(() => db.concursosDosier.concursos.find(r => r.id === 'prueba-2027').interes)).toBe('si');
  expect(errors).toEqual([]);
});

test('móvil: se entra desde Hoy y las fichas caben sin scroll lateral', async ({ page }) => {
  await prepare(page, { width: 390, height: 844 });
  await page.locator('.mv2-tile:has-text("Oportunidades")').first().click();
  const view = page.locator('#view-concursos');
  await expect(view.locator('.cd-card')).not.toHaveCount(0);
  await view.locator('.cd-card').first().locator('summary').click();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});
