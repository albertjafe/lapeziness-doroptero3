import { test, expect } from '@playwright/test';

const base = {
  obras: [],
  eventos: [],
  sesiones: [],
  registro: [],
  sessionPlants: [],
  forestPlants: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [],
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
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil:'domcontentloaded' });
  await page.waitForTimeout(1400);
}

test('mobile header keeps the next competition deadline compact', async ({ page }) => {
  const data = structuredClone(base);
  data.eventos = [
    {
      id:'brescia-parent', nombre:'Brescia Classica International Piano Competition', tipo:'concurso',
      fecha:'2026-10-19', fechaFin:'2026-10-25', estado:'standby', planSourceId:'dossier-2026-2027:brescia-classica-2026',
      competition:{ source:'dossier', name:'Brescia Classica International Piano Competition', location:'Brescia, Italia', start:'2026-10-19', end:'2026-10-25', deadline:'2026-09-26', requiresVideo:false }
    },
    {
      id:'brescia-deadline', nombre:'Inscripción · Brescia Classica International Piano Competition', tipo:'concurso',
      fecha:'2026-09-26', estado:'standby', esHito:true, hitoTipo:'deadline', parentSourceId:'dossier-2026-2027:brescia-classica-2026',
      competition:{ source:'dossier', name:'Brescia Classica International Piano Competition', location:'Brescia, Italia', start:'2026-10-19', end:'2026-10-25', deadline:'2026-09-26', requiresVideo:false }
    }
  ];
  await page.setViewportSize({ width:390, height:844 });
  await prepare(page, data);

  const chip = page.locator('#mobileCompetitionDeadline');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Brescia Classica');
  await expect(chip).toContainText('Inscripción');
  await expect(chip).not.toContainText('International Piano Competition');
  await expect(page.locator('#headerDate')).toBeHidden();
});

test('Montreal is present once and its iPad modal leads with place dates prize age and video', async ({ page }) => {
  await page.setViewportSize({ width:1024, height:768 });
  await prepare(page);

  const state = await page.evaluate(() => {
    const source = 'dossier-2026-2027:montreal-2027';
    const parents = db.eventos.filter(event => event.planSourceId === source && !event.esHito);
    const deadlines = db.eventos.filter(event => event.parentSourceId === source && event.hitoTipo === 'deadline');
    return { parents:parents.length, deadlines:deadlines.length, parentId:parents[0]?.id || null };
  });
  expect(state.parents).toBe(1);
  expect(state.deadlines).toBe(1);

  await page.evaluate(parentId => {
    document.getElementById('eventoEditId').value = parentId;
    document.getElementById('modalAddEvento').classList.add('open');
  }, state.parentId);
  await page.waitForTimeout(150);

  const hero = page.locator('#competitionDossierHero');
  await expect(hero).toBeVisible();
  await expect(hero).toContainText('Concours musical international de Montréal');
  await expect(hero).toContainText('Montréal, Canadá');
  await expect(hero).toContainText('24–5');
  await expect(hero).toContainText('CAD 70.000');
  await expect(hero).toContainText('18–30 años');
  await expect(hero).toContainText('4 vídeos');
  await expect(hero).toContainText('31 oct 2026');

  const width = await page.locator('#modalAddEvento .evento-modal').evaluate(element => element.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(900);
  await expect(page.locator('#eventPlanningSourceCard')).toBeHidden();
  await expect(page.locator('#competitionDossierInfo .competition-info-detail')).toHaveCount(5);
});
