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
  await page.getByRole('button', { name: 'Editar hábito', exact: true }).click();
  await expect(page.locator('#habitModalTitle')).toHaveText('Tu hábito');
  await expect(page.locator('#habitCriteriaInput')).toHaveValue('Completar diez minutos con temporizador.');
});

test('prepares a rulebook with the AI and it rules from tomorrow, never today', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1194 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* isolated */' }));
  await page.addInitScript(value => {
    const d = new Date();
    const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const doc = { ...value, habitChallenges: [{ id: 'habit-detox', title: 'Desintoxicación por la mañana', mode: 'avoid', startDate: today, durationDays: 21, logs: {}, createdAt: today + 'T07:00:00Z', updatedAt: today + 'T07:00:00Z' }] };
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(doc));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, { ...data, habitChallenges: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HabitRulebook && window.openHabitos);
  await page.evaluate(() => openHabitos('habit-detox'));

  const normas = page.locator('#view-habitos .hp-normas');
  await expect(normas).toContainText('Sin reglamento. Prepáralo con la IA');
  await normas.getByRole('button', { name: 'Preparar reglamento con IA', exact: true }).click();
  await expect(page.locator('#modalHabitRulebook')).toHaveClass(/visible/);
  await expect(page.locator('#hrbIntro')).toContainText('rige desde mañana');
  await expect(page.locator('#hrbSaveBtn')).toBeDisabled();

  await page.locator('#hrbCases').fill('¿Y si estoy en el tren?');
  await page.getByRole('button', { name: 'Copiar petición para la IA', exact: true }).click();
  await expect(page.locator('#hrbCopyNote')).not.toBeEmpty();

  await page.locator('#hrbPaste').fill('Hola');
  await expect(page.locator('#hrbPreview')).toContainText('No encuentro el reglamento');
  await expect(page.locator('#hrbSaveBtn')).toBeDisabled();

  await page.locator('#hrbPaste').fill([
    'REGLAMENTO',
    'REGLA: Sin pantallas hasta 60 min de estudio o las 13:00.',
    'ES RECAÍDA:', '- Abrir WhatsApp para leer.',
    'NO ES RECAÍDA:', '- Enseñar un billete en el tren.',
    'EXCEPCIONES:', '- Urgencia real → atender una llamada.',
    'EJEMPLOS:', '- En el tren enseño el billete | NO | Uso permitido.', '- Miro WhatsApp después | RECAÍDA | Otra cosa.',
    'FIN',
  ].join('\n'));
  await expect(page.locator('#hrbPreview')).toContainText('1 caso es recaída y 1 no.');
  await page.locator('#hrbSaveBtn').click();
  await expect(page.locator('#modalHabitRulebook')).not.toHaveClass(/visible/);

  await expect(normas.locator('.hp-rb-pending')).toContainText('Reglamento nuevo desde el');
  await expect(normas.locator('.hp-rb-rule')).toContainText('Sin pantallas hasta 60 min de estudio o las 13:00.');
  await expect(normas.locator('.hp-rb-cases summary')).toContainText('Casos resueltos 2');
  const saved = await page.evaluate(() => {
    const h = db.habitChallenges.find(item => item.id === 'habit-detox');
    return { versions: h.rulebooks.length, from: h.rulebooks[0].effectiveFrom, today: habitDayKey(), tomorrow: habitKeyAt(habitDayKey(), 1) };
  });
  expect(saved.versions).toBe(1);
  expect(saved.from).toBe(saved.tomorrow);
});

test('a lapse after finishing keeps the trophy; the threshold reopens the challenge next to the current one', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 1194 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* isolated */' }));
  await page.addInitScript(value => {
    const key = offset => { const d = new Date(); d.setDate(d.getDate() + offset); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const doc = { ...value, habitChallenges: [
      { id: 'habit-bed', title: 'No móvil en la cama', mode: 'avoid', startDate: key(-40), durationDays: 21, logs: {}, maintenanceLogs: { [key(-6)]: { status: 'lapse', at: '2026-09-01T22:00:00Z', note: 'Siesta con el móvil' } }, createdAt: '2026-08-23T14:35:00Z', updatedAt: '2026-09-12T12:00:00Z' },
      { id: 'habit-detox', title: 'Desintoxicación por la mañana', mode: 'avoid', startDate: key(-2), durationDays: 21, logs: {}, createdAt: '2026-09-26T07:00:00Z', updatedAt: '2026-09-26T07:00:00Z' },
    ] };
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(doc));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, { ...data, habitChallenges: [] });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.HabitMaintenance && window.openHabitos);
  await page.evaluate(() => openHabitos('habit-bed'));

  const maint = page.locator('#view-habitos .hp-maint');
  await expect(maint).toContainText('días sin caídas');
  await maint.getByRole('button', { name: 'Registrar caída', exact: true }).click();
  await expect(page.locator('#modalHabitLapse')).toHaveClass(/visible/);
  await page.locator('#hlYesterday').click();
  await page.locator('#hlNote').fill('Cogí el móvil de la mesilla');
  await page.locator('#modalHabitLapse .modal-btn.primary').click();
  await expect(page.locator('#modalHabitLapse')).not.toHaveClass(/visible/);
  // Tras apuntarla, la app propone acciones; «Ahora no» las descarta.
  const actions = page.locator('#modalHabitAction');
  await expect(actions).toHaveClass(/visible/);
  await expect(actions).toContainText('Caída apuntada');
  await expect(page.locator('#hlaReopen')).toBeHidden();
  await actions.getByRole('button', { name: 'Ahora no' }).click();
  await expect(actions).not.toHaveClass(/visible/);
  await expect(maint.locator('.hp-maint-state')).toContainText('Caída aislada');
  await expect(maint.locator('.hp-maint-list')).toContainText('Cogí el móvil de la mesilla');
  // Recién apuntada, se puede quitar si fue un error; el trofeo sigue.
  await expect(maint.getByRole('button', { name: 'Quitar', exact: true })).toBeVisible();
  await expect(page.locator('#view-habitos .hp-card.is-earned')).toHaveCount(1);

  await maint.getByRole('button', { name: 'Registrar caída', exact: true }).click();
  await page.locator('#hlToday').click();
  await page.locator('#modalHabitLapse .modal-btn.primary').click();
  // Con la tercera caída en 14 días, la propia ventana de acciones ofrece reabrir.
  await expect(page.locator('#hlaReopen')).toBeVisible();
  await actions.getByRole('button', { name: 'Ahora no' }).click();
  await expect(maint.locator('.hp-maint-state')).toContainText('Esto ya es una recaída');
  await maint.getByRole('button', { name: 'Reabrir el reto (14 días)', exact: true }).click();

  await expect(page.locator('.hp-detail .hp-kicker')).toContainText('reabierto');
  const actives = await page.evaluate(() => habitActiveChallenges().map(h => [h.title, !!h.reopenOf]));
  expect(actives).toEqual([['Desintoxicación por la mañana', false], ['No móvil en la cama', true]]);
  const reopened = await page.evaluate(() => db.habitChallenges.find(h => h.reopenOf === 'habit-bed'));
  expect(reopened.startDate).toBe(await page.evaluate(() => habitKeyAt(habitDayKey(), 1)));
  expect(reopened.effortReward).toBeUndefined();
  // Sin id, el modal sigue abriendo el hábito principal, no el reabierto.
  await page.evaluate(() => openHabitChallengeModal());
  await expect(page.locator('#habitTitleInput')).toHaveValue('Desintoxicación por la mañana');
});

test('a new challenge carrying leftovers of an old one is not shown as finished in August', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(() => {
    const d = new Date(); d.setDate(d.getDate() - 1);
    const start = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const habit = habitNormalize({
      id: 'habit_new', title: 'Sin consumo hasta 1 h de estudio', mode: 'avoid', startDate: start, durationDays: 21,
      completedAt: '2026-08-22', rewardClaimedAt: '2026-08-22T09:44:08Z',
      logs: { '2026-08-02': { status: 'failed' }, [start]: { status: 'failed' } },
    });
    return { completed: habitIsCompleted(habit, new Date()), logs: Object.keys(habit.logs), completedAt: habit.completedAt ?? null,
      claimed: habit.rewardClaimedAt ?? null, start };
  });
  expect(result.completed).toBe(false);
  expect(result.completedAt).toBeNull();
  expect(result.claimed).toBeNull();
  expect(result.logs).toEqual([result.start]);
});
