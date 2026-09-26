import { test, expect, devices } from '@playwright/test';

test.use({ ...devices['iPhone 13'], defaultBrowserType: undefined });

const day = k => { const d = new Date(); d.setDate(d.getDate() - k); return d; };
const fixture = () => ({
  competitionPlanningSeedVersion: 999,
  obras: [
    { id: 'b', name: 'Partita nº 2', composer: 'Bach', dificultad: 7, movimientos: [{ id: 'cap', name: 'Capriccio', solHistory: [] }, { id: 'sin', name: 'Sinfonia', solHistory: [{ date: day(3).toISOString(), val: 60 }] }] },
    { id: 'c', name: 'Balada nº 1', composer: 'Chopin', movimientos: [], solHistory: [{ date: day(2).toISOString(), val: 55 }] },
  ],
  eventos: [{ id: 'e', nombre: 'Recital', tipo: 'concierto', fecha: day(-10).toISOString().slice(0, 10), obras: ['b', 'c'] }],
  sessionPlants: [{ id: 'p', obraId: 'c', mins: 50, startedAt: day(1).toISOString(), endedAt: day(1).toISOString() }],
  sesiones: [], forestPlants: [], registro: [],
});

async function boot(page) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.addInitScript(data => { if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(data)); }, fixture());
  await page.goto('/');
  await page.waitForFunction(() => window.MobileV2 && typeof showView === 'function');
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} showView('session'); });
}

test('Hoy v2: anillo con una frase, Para hoy urgente y ▶ abre el cronómetro con la obra', async ({ page }) => {
  await boot(page);
  await expect(page.locator('html')).toHaveClass(/mobile-v2/);
  await expect(page.locator('#mv2Hoy .mv2-summary')).toBeVisible();
  await expect(page.locator('#sessionResumenCard')).toBeHidden();
  await expect(page.locator('#mv2Hoy .mv2-summary b')).toHaveText(/4 h|empezado/);
  // Las prioridades del Profesor llegan tras cargar su núcleo.
  await expect(page.locator('#mv2Hoy .mv2-parahoy .mv2-plan').first()).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#mv2Hoy .mv2-parahoy')).toContainText('lo más urgente');
  const first = page.locator('#mv2Hoy .mv2-plan').first();
  const label = (await first.locator('b').textContent()).trim();
  await first.click();
  await expect(page.locator('body')).toHaveAttribute('data-view', 'cronometro');
  const chosen = await page.evaluate(() => { const v = document.getElementById('cronoObraSelect').value; return cronoResolveSelectValue(v); });
  expect(label).toContain(chosen.displayName);
});

test('Hoy v2: el plan del Profesor pegado sustituye a lo urgente y enlaza obras', async ({ page }) => {
  await boot(page);
  await page.locator('#mv2Hoy .mv2-link', { hasText: 'Pegar plan' }).click();
  await page.locator('#mv2PasteInput').fill('Buen día.\nPLAN_PARA_HOY\n- 45 min | Balada nº 1 | coda en frío\n- 30 | Partita nº 2 · Capriccio | fuga lenta\n');
  await page.getByRole('button', { name: 'Guardar plan' }).click();
  await expect(page.locator('#mv2Hoy .mv2-parahoy')).toContainText('plan del Profesor');
  await expect(page.locator('#mv2Hoy .mv2-plan')).toHaveCount(2);
  await expect(page.locator('#mv2Hoy .mv2-pill')).toHaveText('1 h 15');
  const saved = await page.evaluate(() => MobileV2.planToday(db).items.map(i => [i.obraId, i.movId || null, i.minutes]));
  expect(saved).toEqual([['c', null, 45], ['b', 'cap', 30]]);
  await page.locator('#mv2Hoy .mv2-plan').nth(1).click();
  expect(await page.evaluate(() => document.getElementById('cronoObraSelect').value)).toBe('mov::b::cap');
  await page.evaluate(() => showView('session'));
  await page.getByRole('button', { name: 'Quitar plan' }).click();
  await expect(page.locator('#mv2Hoy .mv2-parahoy')).toContainText('lo más urgente');
  // Un plan nuevo sustituye entero al anterior (no se mezclan bloques).
  await page.locator('#mv2Hoy .mv2-link', { hasText: 'Pegar plan' }).click();
  await page.locator('#mv2PasteInput').fill('PLAN_PARA_HOY\n20 | Partita nº 2 · Sinfonia | lento');
  await page.getByRole('button', { name: 'Guardar plan' }).click();
  await expect(page.locator('#mv2Hoy .mv2-plan')).toHaveCount(1);
});

test('Hoy v2: nada se pierde — registro rápido, diario y Aulas siguen a un toque', async ({ page }) => {
  await boot(page);
  await expect(page.locator('#view-session .session-quick-disclosure')).toBeHidden();
  await page.getByRole('button', { name: /Añadir estudio, nota o tarea/ }).click();
  await page.getByRole('button', { name: /Estudio de hoy/ }).click();
  await expect(page.locator('#view-session .session-quick-disclosure')).toBeVisible();
  await expect(page.locator('#sessionQuickStudyObra')).toBeVisible();
  await page.getByRole('button', { name: /Añadir estudio, nota o tarea/ }).click();
  await page.getByRole('button', { name: /Nota en el diario/ }).click();
  await expect(page.locator('#sessionJournalInput')).toBeVisible();
  await expect(page.locator('#sessionAulasDashboard')).toBeHidden();
  await page.locator('#mv2Hoy .mv2-rowcard', { hasText: 'Aulas' }).click();
  await expect(page.locator('#sessionAulasDashboard')).toBeVisible();
});

test('Ajustes: «Clásico» recupera el diseño anterior y «Nuevo» lo devuelve', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openSettings());
  await page.getByRole('button', { name: 'Clásico', exact: true }).click();
  await expect(page.locator('html')).not.toHaveClass(/mobile-v2/);
  await page.evaluate(() => showView('session'));
  await expect(page.locator('#sessionResumenCard')).toBeVisible();
  await expect(page.locator('#mv2Hoy')).toBeHidden();
  await page.reload();
  await page.waitForFunction(() => window.MobileV2);
  await expect(page.locator('html')).not.toHaveClass(/mobile-v2/);
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} MobileV2.setDesign('v2'); showView('session'); });
  await expect(page.locator('#mv2Hoy .mv2-summary')).toBeVisible();
});

async function chooseWork(page) {
  await page.evaluate(() => {
    showView('cronometro');
    const sel = document.getElementById('cronoObraSelect');
    if (typeof cronoFillObraSelect === 'function') cronoFillObraSelect();
    sel.value = [...sel.options].find(o => o.value).value;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.waitForFunction(() => typeof cronoHydrate === 'function'); await page.evaluate(() => cronoHydrate());
}
const inViewport = locator => locator.evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.height > 20; });

test('Cronómetro v2: Iniciar a la vista sin scroll; en marcha, Pausar y Terminar grandes', async ({ page }) => {
  await boot(page);
  await chooseWork(page);
  const start = page.locator('#cronoStartBtn');
  await expect(start).toBeEnabled();
  expect(await inViewport(start)).toBe(true);
  // El Iniciar no queda tapado por la hoja de herramientas plegada.
  const sheetTop = await page.locator('#cronoIdleDrawer').evaluate(el => el.getBoundingClientRect().top);
  expect((await start.boundingBox()).y + (await start.boundingBox()).height).toBeLessThanOrEqual(sheetTop);
  await expect(page.locator('#view-cronometro .crono-readiness-chip')).toBeHidden();
  await start.click();
  await expect.poll(() => page.evaluate(() => crono.state)).toBe('running');
  const pause = page.getByRole('button', { name: 'Pausar', exact: true });
  const finish = page.getByRole('button', { name: 'Terminar', exact: true });
  await expect(pause).toBeVisible();
  await expect(finish).toBeVisible();
  expect(await inViewport(page.locator('#cronoDisplay'))).toBe(true);
  expect(await inViewport(finish)).toBe(true);
  await finish.click();
  // Menos de un minuto: la app pregunta si descartar la sesión; si no, si guardarla.
  await expect(page.locator('.modal-overlay.visible')).toHaveCount(1);
  expect(await page.evaluate(() => crono.state)).toBe('running');
});

test('Cronómetro v2: la mesa de trabajo es una hoja que se abre al tocar una pestaña', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => { db.cronoTasks = [{ id: 't', text: 'Digitar compás 40', kind: 'piano', priority: 1, done: false, createdAt: new Date().toISOString() }]; saveData(); });
  await chooseWork(page);
  const drawer = page.locator('#cronoIdleDrawer');
  await expect(drawer.locator('.crono-run-drawer-panels')).toBeHidden();
  await drawer.getByRole('tab', { name: /Pasajes/ }).click();
  await expect(drawer).toHaveClass(/mv2-sheet-open/);
  await expect(drawer.locator('.crono-run-drawer-panels')).toBeVisible();
  await page.locator('#mv2SheetScrim').click({ position: { x: 20, y: 40 } });
  await expect(drawer).not.toHaveClass(/mv2-sheet-open/);
});
