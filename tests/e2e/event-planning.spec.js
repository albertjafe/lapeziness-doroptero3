import { test, expect } from '@playwright/test';

const fixture = {
  obras: [
    { id: 'obra_1', name: 'Beethoven · Waldstein I', composer: 'L. van Beethoven', tipo: 'obra', movimientos: [], sol: 55, solHistory: [] },
  ],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

async function prepare(page, data = fixture) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en smoke tests */',
  }));
  await page.addInitScript(seed => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(seed));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => Boolean(window.EventPlanning), null, { timeout: 10_000 });
}

test('adds Exam and professional planning fields to the event modal', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => {
    showView('calendario');
    openAddEvento();
  });

  await expect(page.locator('#eventoTipoSelector .evento-tipo-btn.examen')).toHaveText('Examen');
  await expect(page.locator('#eventoEstado')).toBeVisible();
  await expect(page.locator('#eventoLugarPlan')).toBeVisible();
  await expect(page.locator('#eventoDeadline')).toBeVisible();
  await expect(page.locator('#eventoGrabacionObjetivo')).toBeVisible();
  await expect(page.locator('#eventoVideoRequisitos')).toBeVisible();
});

test('imports Maria Canals as standby plus one linked deadline and is idempotent', async ({ page }) => {
  await prepare(page);

  const first = await page.evaluate(() => {
    const result = EventPlanning.importCompetitions(['maria-canals-2027'], true);
    const parent = db.eventos.find(event => event.planSourceId === 'dossier-2026-2027:maria-canals-2027' && !event.esHito);
    const deadline = db.eventos.find(event => event.parentSourceId === 'dossier-2026-2027:maria-canals-2027' && event.hitoTipo === 'deadline');
    return { result, parent, deadline, count: db.eventos.length, plans: db.competitionPlans };
  });

  expect(first.parent).toMatchObject({
    nombre: 'Maria Canals International Piano Competition',
    tipo: 'concurso',
    estado: 'standby',
    fecha: '2027-03-07',
    fechaFin: '2027-03-18',
    deadline: '2026-11-23',
    lugar: 'Barcelona, España',
  });
  expect(first.parent.videoRequisitos).toContain('Dos vídeos');
  expect(first.deadline).toMatchObject({
    fecha: '2026-11-23',
    estado: 'standby',
    esHito: true,
    hitoTipo: 'deadline',
  });
  expect(first.deadline.nombre).toContain('Vídeo / inscripción');
  expect(first.plans).toHaveLength(1);

  const second = await page.evaluate(() => {
    EventPlanning.importCompetitions(['maria-canals-2027'], true);
    return {
      parents: db.eventos.filter(event => event.planSourceId === 'dossier-2026-2027:maria-canals-2027' && !event.esHito).length,
      deadlines: db.eventos.filter(event => event.parentSourceId === 'dossier-2026-2027:maria-canals-2027' && event.hitoTipo === 'deadline').length,
      count: db.eventos.length,
      plans: db.competitionPlans.length,
    };
  });
  expect(second).toEqual({ parents: 1, deadlines: 1, count: first.count, plans: 1 });
});

test('keeps competitions without exact dates in follow-up instead of inventing calendar dates', async ({ page }) => {
  await prepare(page);
  const snapshot = await page.evaluate(() => {
    EventPlanning.importCompetitions(['ciurlionis-2027', 'rncm-mottram-2027', 'tchaikovsky-2027'], true);
    showView('calendario');
    return {
      eventNames: db.eventos.map(event => event.nombre),
      plans: db.competitionPlans.map(plan => ({ name: plan.name, start: plan.start, dateNote: plan.dateNote })),
    };
  });

  expect(snapshot.eventNames).not.toContain('M. K. Čiurlionis International Piano and Organ Competition');
  expect(snapshot.eventNames).not.toContain('RNCM James Mottram International Piano Competition');
  expect(snapshot.eventNames).not.toContain('International Tchaikovsky Competition');
  expect(snapshot.plans).toHaveLength(3);
  expect(snapshot.plans.every(plan => plan.start === null)).toBe(true);
  await expect(page.locator('#competitionWatchlist')).toBeVisible();
  await expect(page.locator('#competitionWatchlist')).toContainText('Concursos sin fecha exacta');
});
