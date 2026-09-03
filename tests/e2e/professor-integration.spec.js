import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{
    id: 'obra_1', name: 'Waldstein', composer: 'L. van Beethoven', tipo: 'obra', sol: 72,
    movimientos: [{ id: 'mov_1', name: 'I. Allegro', sol: 68, solHistory: [] }], solHistory: [], paseHistory: [],
  }],
  eventos: [{
    id: 'exam_1', nombre: 'Examen de repertorio', tipo: 'examen', estado: 'planificado',
    fecha: '2026-09-22', obras: ['obra_1'],
  }],
  sesiones: [], registro: [], sessionPlants: [], forestPlants: [], cronoTasks: [], weeklyPlans: [],
  estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [], competitionPlanningSeedVersion: 1,
};

test('Professor is visible, opens, and exposes ChatGPT planning actions', async ({ page }) => {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase blocked in integration test */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, fixture);

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => Boolean(window.ProfessorCore && window.renderProfessorDashboard))).toBe(true);

  const nav = page.locator('body > .nav-bottom .nav-btn[data-view="profesor"]');
  await expect(nav).toBeVisible();
  await expect(nav).toContainText('Profesor');
  await nav.click();

  await expect(page.locator('#view-profesor')).toHaveClass(/active/);
  await expect(page.locator('#view-profesor')).toContainText('Superinforme');
  await expect(page.locator('#view-profesor')).toContainText('Organizar lo que queda de hoy');
  await expect(page.locator('#view-profesor')).toContainText('¿Qué estudio ahora?');
  await expect(page.locator('#view-profesor')).toContainText('Próximos 7 días');
  await expect(page.locator('#headerTitle')).toHaveText('Profesor');

  expect(await page.evaluate(() => typeof window.openProfessorInChatGPT)).toBe('function');
  expect(await page.locator('#view-casa').count()).toBe(0);
});
