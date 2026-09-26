import { test, expect } from '@playwright/test';

const data = {
  obras: [{ id: 'obra_1', name: 'Bach', movimientos: [] }], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
  habitChallenges: [
    { id: 'habit-bathroom', title: 'No coger el móvil en el baño', mode: 'avoid', startDate: '2026-08-02', durationDays: 21, description: 'Dejar el móvil fuera del baño.', logs: { '2026-08-02': { status: 'failed' } }, createdAt: '2026-08-02T16:23:00Z', updatedAt: '2026-08-22T12:00:00Z' },
    { id: 'habit-bed', title: 'No móvil en la cama', mode: 'avoid', startDate: '2026-08-23', durationDays: 21, logs: {}, createdAt: '2026-08-23T14:35:00Z', updatedAt: '2026-09-12T12:00:00Z' },
  ],
};

async function prepare(page) {
  await page.setViewportSize({ width: 1024, height: 1194 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* isolated */' }));
  await page.addInitScript(value => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(value));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HabitTrophies && window.setCronoCalendarObjectivesMode);
  await page.evaluate(() => showView('cronometro'));
}

test('shows the two completed habit goals in the stopwatch trophy case', async ({ page }) => {
  await prepare(page);
  await page.getByRole('button', { name: 'Abrir la página de hábitos', exact: true }).click();
  await expect(page.locator('#view-habitos')).toHaveClass(/active/);
  await expect(page.locator('#view-habitos .hp-card')).toHaveCount(2);
  await expect(page.locator('#view-habitos .hp-card.is-earned')).toHaveCount(2);
  await expect(page.locator('.hp-collection-head')).toContainText('2 trofeos');
  const bed = page.locator('.hp-card').filter({ hasText: 'No móvil en la cama' });
  await expect(bed).toContainText('12 sept 2026');
  const bath = page.locator('.hp-card').filter({ hasText: 'No coger el móvil en el baño' });
  await expect(bath).toContainText('20 de 21 días');
  // A card button and its insignia button are siblings, never nested.
  await expect(page.locator('.hp-card-select button')).toHaveCount(0);

  await bath.locator('.hp-card-select').click();
  await expect(page.locator('.hp-detail h2')).toHaveText('No coger el móvil en el baño');
  await expect(page.locator('.hp-detail .hp-desc')).toHaveText('Dejar el móvil fuera del baño.');
  await expect(page.locator('.hp-detail .hp-days li')).toHaveCount(21);
  await page.getByRole('button', { name: 'Ver ficha completa', exact: true }).click();
  await expect(page.locator('#habitModalTitle')).toHaveText('Hábito terminado');
  await expect(page.locator('#habitDescriptionInput')).toHaveValue('Dejar el móvil fuera del baño.');
  await expect(page.locator('#habitDescriptionInput')).toBeDisabled();
  await expect(page.locator('#habitSaveBtn')).toBeHidden();
  await page.getByRole('button', { name: 'Cerrar', exact: true }).click();

  await page.evaluate(() => showView('deutsch'));
  await expect(page.getByRole('navigation', { name: 'Deutsch' }).getByRole('button', { name: 'Trofeos' })).toHaveCount(0);
});

test('creates a detailed objective and keeps every optional field in the synced object', async ({ page }) => {
  await prepare(page);
  await page.evaluate(() => openHabitChallengeModal());
  await page.locator('#habitTitleInput').fill('Meditar cada mañana');
  await page.locator('#habitDescriptionInput').fill('Diez minutos antes de mirar mensajes.');
  await page.locator('#habitMotivationInput').fill('Empezar el día con calma.');
  await page.locator('#habitCriteriaInput').fill('Completar diez minutos con temporizador.');
  await page.locator('#habitRewardInput').fill('Desayuno especial el último día.');
  await page.locator('#habitDurationInput').fill('7');
  await page.locator('#modalHabitChallenge .modal-btn.primary').click();
  // The modal only closes after a successful save.
  await expect(page.locator('#modalHabitChallenge')).not.toHaveClass(/visible/);
  await expect.poll(() => page.evaluate(() => db.habitChallenges.some(item => item.title === 'Meditar cada mañana'))).toBe(true);

  const saved = await page.evaluate(() => {
    const habit = db.habitChallenges.find(item => item.title === 'Meditar cada mañana');
    return habit && {
      title: habit.title, description: habit.description, motivation: habit.motivation,
      successCriteria: habit.successCriteria, reward: habit.reward, durationDays: habit.durationDays, startDate: habit.startDate,
    };
  });
  expect(saved).toMatchObject({
    title: 'Meditar cada mañana', description: 'Diez minutos antes de mirar mensajes.', motivation: 'Empezar el día con calma.',
    successCriteria: 'Completar diez minutos con temporizador.', reward: 'Desayuno especial el último día.', durationDays: 7,
  });
  expect(saved.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);

  await page.getByRole('tab', { name: 'Hábitos', exact: true }).click();
  await page.getByRole('button', { name: 'Ver detalles y reglas de Meditar cada mañana', exact: true }).click();
  await expect(page.locator('#view-habitos .hp-card')).toHaveCount(3);
  await expect(page.locator('#view-habitos .hp-card.is-earned')).toHaveCount(2);
  await expect(page.locator('.hp-detail h2')).toHaveText('Meditar cada mañana');
  await expect(page.locator('.hp-detail .hp-rules')).toContainText('Completar diez minutos con temporizador.');
  await expect(page.locator('.hp-detail .hp-rules')).toContainText('Empezar el día con calma.');
  await page.getByRole('button', { name: 'Editar normas', exact: true }).click();
  await expect(page.locator('#habitModalTitle')).toHaveText('Tu hábito');
  await expect(page.locator('#habitCriteriaInput')).toHaveValue('Completar diez minutos con temporizador.');
});
