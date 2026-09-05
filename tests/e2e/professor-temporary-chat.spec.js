import { test, expect } from '@playwright/test';

function fixture() {
  return {
    obras: [{ id: 'w1', name: 'Sonata', composer: 'Beethoven', tipo: 'obra', sol: 70, solHistory: [], movimientos: [] }],
    eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
    estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
    tiempoDisponibleEventos: [], dailyJournalEntries: [],
  };
}

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase bloqueado en tests */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    localStorage.removeItem('professorTemporaryChat_v1');
  }, fixture());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.ProfessorTemporaryChat && !!window.ProfessorCore)).toBe(true);
}

test('Professor handoff defaults to temporary ChatGPT without changing its prompt', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const report = ProfessorCore.buildReport(db, { asOf: new Date('2026-09-04T10:00:00+02:00') });
    const built = ProfessorCore.buildChatGptUrl(report, { mode: 'today', note: 'Solo tengo 2 horas.' });
    const url = new URL(built.url);
    return {
      temporary: url.searchParams.get('temporary-chat'),
      promptParam: url.searchParams.get('prompt'),
      promptForUrl: built.promptForUrl,
      transport: built.transport,
    };
  });

  expect(result.temporary).toBe('true');
  if(result.transport === 'url') expect(result.promptParam).toBe(result.promptForUrl);
  else expect(result.promptParam).toBeNull();
  expect(result.promptForUrl).toContain('Solo tengo 2 horas.');
});

test('temporary Professor handoff can be disabled from its persisted toggle', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    ProfessorTemporaryChat.setEnabled(false);
    const report = ProfessorCore.buildReport(db, { asOf: new Date('2026-09-04T10:00:00+02:00') });
    const built = ProfessorCore.buildChatGptUrl(report, { mode: 'now' });
    return {
      enabled: ProfessorTemporaryChat.enabled(),
      hasTemporary: new URL(built.url).searchParams.has('temporary-chat'),
      stored: localStorage.getItem('professorTemporaryChat_v1'),
    };
  });

  expect(result).toEqual({ enabled: false, hasTemporary: false, stored: 'false' });
});
