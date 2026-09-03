import { test, expect } from '@playwright/test';

const base = {
  obras: [{ id:'obra_1', name:'Bach · Preludio', composer:'J. S. Bach', tipo:'obra', movimientos:[], sol:50, solHistory:[] }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [], weeklyPlans: [],
  competitionPlanningSeedVersion: 1,
};

async function prepare(page, data = base) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en smoke tests */',
  }));
  await page.addInitScript(seed => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(seed));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision:0, dirtyRevision:0, lastSyncedRevision:0 }));
  }, data);
  await page.goto('/', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect.poll(() => page.evaluate(() => Boolean(window.PlanningEnhancementsV3))).toBe(true);
}

test('dictated task keywords set urgentissima, urgente, normal or blank priority', async ({ page }) => {
  await prepare(page);
  expect(await page.evaluate(() => [
    PlanningEnhancementsV3.priorityFromText('Repasar esto urgentísima'),
    PlanningEnhancementsV3.priorityFromText('Esto es URGENTE'),
    PlanningEnhancementsV3.priorityFromText('Tarea normal'),
    PlanningEnhancementsV3.priorityFromText('Solo tocar lento'),
  ])).toEqual([3,2,1,0]);

  await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'obra::obra_1';
    cronoUpdateStartBtn();
  });
  await page.locator('#cronoStageIdle .crono-tomorrow-note-btn').click();
  await page.locator('#cronoNoteInput').fill('Revisar el final urgentísima');
  await page.locator('#modalCronoNote').getByRole('button', { name:'Guardar', exact:true }).click();
  await expect.poll(() => page.evaluate(() => cronoTasks().find(item => item.source === 'tomorrow-note')?.priority)).toBe(3);
});

test('project event can use a month instead of inventing an exact date', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    showView('calendario');
    switchCalTab('eventos', document.getElementById('calTabEventos'));
    openAddEvento();
  });
  const project = page.locator('#eventoTipoSelector [data-evento-tipo="proyecto"]');
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.locator('#eventProjectTiming')).toBeVisible();
  await page.locator('#eventoNombre').fill('Tener nueva composición lista');
  await page.locator('#eventProjectTiming [data-project-mode="month"]').click();
  await page.locator('#eventoProyectoMes').fill('2026-10');
  await page.locator('#modalAddEvento .modal-btn.primary').click();

  const saved = await page.evaluate(() => db.eventos.find(item => item.tipo === 'proyecto'));
  expect(saved).toMatchObject({
    tipo:'proyecto',
    fecha:'2026-10-31',
    fechaFlexibleTipo:'mes',
    fechaObjetivoMes:'2026-10',
    fechaFlexibleDesde:'2026-10-01',
    fechaFlexibleHasta:'2026-10-31',
  });
  expect(saved.fechaFlexibleLabel.toLowerCase()).toContain('octubre');
  expect(await page.evaluate(event => PlanningEnhancementsV3.projectWindow(event), saved)).toEqual({ start:'2026-10-01', end:'2026-10-31', flexible:true });
});

test('solidity guide covers new works, chamber with score and recovered repertoire', async ({ page }) => {
  await prepare(page);
  const guide = page.locator('#solidityGuideQuickV3');
  await expect(guide).toContainText('Obra nueva');
  await expect(guide).toContainText('Cámara · con partitura');
  await expect(guide).toContainText('No penalices por tocar con partitura');
  await expect(guide).toContainText('Repertorio recuperado');
  await expect(guide).toContainText('no infla la píldora actual');
  await expect(guide).toContainText('90–96');
  await expect(guide).toContainText('100');
});

test('competition dossier exposes a clickable official website', async ({ page }) => {
  const data = structuredClone(base);
  data.eventos = [{
    id:'maria', nombre:'Maria Canals International Piano Competition', tipo:'concurso', fecha:'2027-03-07', fechaFin:'2027-03-18', estado:'standby',
    planSourceId:'dossier-2026-2027:maria-canals-2027',
    competition:{ source:'dossier', name:'Maria Canals International Piano Competition', location:'Barcelona, España', start:'2027-03-07', end:'2027-03-18', deadline:'2026-11-23', requiresVideo:true, video:'Dos vídeos, máx. 20 min', eligibility:'17–29 años', prizes:'25.000 EUR' }
  }];
  await prepare(page, data);
  await page.evaluate(() => {
    document.getElementById('eventoEditId').value = 'maria';
    document.getElementById('modalAddEvento').classList.add('open');
  });
  const link = page.locator('#competitionDossierHero .competition-official-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /mariacanals\.org/);
  await expect(link).toHaveAttribute('target', '_blank');
});
