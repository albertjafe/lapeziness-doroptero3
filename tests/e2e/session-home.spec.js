import { expect, test } from '@playwright/test';

function isoDay(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function studyFixture() {
  const now = new Date();
  const plants = [];
  for (let daysAgo = 1; daysAgo <= 12; daysAgo += 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo);
    [0, 4, 8, 12, 16, 20].forEach((hour, index) => {
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0);
      plants.push({
        id: `past-${daysAgo}-${index}`,
        obraId: 'obra_1',
        startedAt: start.toISOString(),
        endedAt: new Date(start.getTime() + 45 * 60000).toISOString(),
        mins: 45,
      });
    });
  }
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 7, 0);
  plants.push({
    id: 'today-75', obraId: 'obra_1', startedAt: todayStart.toISOString(),
    endedAt: new Date(todayStart.getTime() + 75 * 60000).toISOString(), mins: 75,
  });
  return {
    obras: [{ id: 'obra_1', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
    eventos: [], sesiones: [], registro: [], sessionPlants: plants, forestPlants: [],
    estadoEventos: [], impulsoEventos: [], malestarEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
    tiempoDisponibleEventos: [], dailyJournalEntries: [],
  };
}

test('shows a compact daily forecast, live classrooms and separate history', async ({ page }) => {
  const fixture = studyFixture();
  const now = new Date();
  const row = {
    user_id: '00000000-0000-4000-8000-000000000001', source: 'alberto', schema_version: 1,
    observed_at: now.toISOString(), heartbeat_at: now.toISOString(), updated_at: now.toISOString(),
    state: {
      date: isoDay(now),
      reservations: [{ event_id: 91, start: '00:00', end: '23:59', room: '113', type: 'Einzelbuchung', status: 'upcoming' }],
      monitor: { online: true, paused: false }, quota: { rf_mins: 90, sz_mins: 60, sz_applicable: true },
    },
  };

  await page.addInitScript(({ fixture, row }) => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(fixture));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    const session = { user: { id: row.user_id } };
    const genericBuilder = () => {
      const builder = {
        select() { return builder; }, eq() { return builder; }, order() { return Promise.resolve({ data: [], error: null }); },
        maybeSingle() { return Promise.resolve({ data: null, error: null }); }, single() { return Promise.resolve({ data: null, error: null }); },
        insert() { return builder; }, update() { return builder; }, upsert() { return builder; }, delete() { return builder; },
        then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); },
      };
      return builder;
    };
    const client = {
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from(table) {
        if (table === 'reservation_monitor_state') {
          const builder = genericBuilder();
          builder.order = async () => ({ data: [row], error: null });
          return builder;
        }
        return genericBuilder();
      },
      channel() { return { on() { return this; }, subscribe() { return this; } }; },
      removeChannel: async () => {}, rpc: async () => ({ data: null, error: null }),
    };
    window.supabase = { createClient: () => client };
  }, { fixture, row });

  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200, contentType: 'application/javascript', body: '/* Supabase supplied by test bootstrap. */',
  }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);

  await expect(page.locator('#sessionResumenCard')).toContainText('Llevas');
  await expect(page.locator('#sessionResumenCard')).toContainText('Proyección');
  await expect(page.locator('#sessionResumenCard')).toContainText(/Fin previsto|Quédate hasta/);
  await expect(page.locator('#sessionConcentradoText')).toContainText(/1\s*h\s*15\s*min/);
  await expect(page.locator('#sessionReservationOverview')).toContainText('Aula 113');
  await expect(page.locator('#activityDailyCard')).toBeHidden();
  await expect(page.locator('#sessionStatsSection')).toBeHidden();

  await page.locator('#sessionModeHistory').click();
  await expect(page.locator('#sessionStatsSection')).toBeVisible();
  await expect(page.locator('#activityDailyCard')).toBeVisible();
  await expect(page.locator('#sessionResumenCard')).toBeHidden();
  await page.locator('#sessionModeToday').click();

  await page.evaluate(() => openSettings());
  const fold = page.locator('.ajustes-fold');
  await expect(fold).not.toHaveAttribute('open', '');
  await fold.locator('summary').click();
  await expect(fold.getByRole('button', { name: 'Disponibilidad' })).toBeVisible();

  if (process.env.CAPTURE_SESSION_HOME) {
    await page.evaluate(() => closeAjustes());
    await page.screenshot({ path: 'test-results/session-home-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/session-home-mobile.png', fullPage: true });
  }
});
