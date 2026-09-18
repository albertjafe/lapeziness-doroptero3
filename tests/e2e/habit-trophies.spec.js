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
  await page.getByRole('tab', { name: 'Vitrina', exact: true }).click();
  await expect(page.locator('.habit-trophy-card')).toHaveCount(2);
  await expect(page.locator('.habit-trophy-card.is-earned')).toHaveCount(2);
  await expect(page.locator('.habit-trophy-room')).toContainText('2/2');
  await expect(page.getByRole('article', { name: /No móvil en la cama/ })).toContainText('23 ago 2026');
  await expect(page.getByRole('article', { name: /No móvil en la cama/ })).toContainText('12 sept 2026');
  await expect(page.getByRole('article', { name: /No coger el móvil en el baño/ })).toContainText('20 de 21 días logrados');

  await page.getByRole('article', { name: /No coger el móvil en el baño/ }).getByRole('button', { name: 'Ver reglas del hábito', exact: true }).click();
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

  await page.getByRole('tab', { name: 'Vitrina', exact: true }).click();
  await expect(page.locator('.habit-trophy-card')).toHaveCount(3);
  await expect(page.locator('.habit-trophy-card.is-earned')).toHaveCount(2);
  await expect(page.getByRole('article', { name: /Meditar cada mañana/ })).toContainText('En curso');

  await page.getByRole('tab', { name: 'Hábitos', exact: true }).click();
  await page.getByRole('button', { name: 'Ver detalles y reglas de Meditar cada mañana', exact: true }).click();
  await expect(page.locator('#habitModalTitle')).toHaveText('Tu hábito');
  await expect(page.locator('#habitCriteriaInput')).toHaveValue('Completar diez minutos con temporizador.');
});
