import { expect, test } from '@playwright/test';

const sampleRow = {
  user_id: '00000000-0000-4000-8000-000000000001',
  source: 'alberto',
  schema_version: 1,
  observed_at: new Date().toISOString(),
  heartbeat_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  state: {
    date: new Date().toISOString().slice(0, 10),
    reservations: [
      { event_id: 91, start: '10:00', end: '12:00', room: '113', type: 'Einzelbuchung', status: 'upcoming', locked: false, confirmed: false },
      { event_id: 92, start: '15:30', end: '17:00', room: '308', type: 'VIP', status: 'upcoming', locked: true, confirmed: false },
    ],
    quota: { rf_mins: 105, sz_mins: 75, sz_applicable: true },
    transition: null,
    monitor: {
      online: true,
      paused: false,
      target_date: new Date().toISOString().slice(0, 10),
      operating_mode: { code: '2', name: 'Grabación' },
      efficient: true,
      paod_state: 'PAOD off',
      migration_enabled: false,
      mirror_enabled: true,
      madrugada_enabled: true,
      aachen_only: false,
      emergency_enabled: true,
      min_slot_duration: 45,
      monitor_window: { start: '10:00', end: '20:30' },
      blind_periods: [], blinded_rooms: [], blinded_groups: [4], priority_rooms: [113, 308],
    },
    scans: [{ group: 5, date: new Date().toISOString().slice(0, 10), mode: 'booking', observed_at: new Date().toISOString() }],
    success_rate: '84%',
  },
};

test('renders live reservations and sends a safe monitor command', async ({ page }) => {
  // Conserva un origen http real para que localStorage esté disponible sin
  // cargar antes el enorme runtime de la app.
  await page.goto('/reservation-dashboard.css?v=369');
  await page.setContent(`<!doctype html><html lang="es" data-theme="marmol"><head>
    <link rel="stylesheet" href="http://127.0.0.1:4173/styles.css?v=342">
    <link rel="stylesheet" href="http://127.0.0.1:4173/reservation-dashboard.css?v=372">
  </head><body data-view="session"><div id="view-session" class="active"><section class="reservation-dashboard" id="sessionAulasDashboard">
    <div class="rd-topline"><div class="rd-title-group"><div class="view-local-label">Reservas Asimut</div><h1>Aulas</h1><p id="reservationDashboardStatus"></p></div><div class="rd-head-actions"><div id="reservationSourceSwitch" class="rd-source-switch"></div><button id="reservationRefresh" class="rd-refresh">↻</button></div></div>
    <div class="rd-pane-tabs"><button class="active" data-reservation-pane="reservations">Mis reservas</button><button data-reservation-pane="piano-rooms">Piano Rooms</button></div>
    <div id="reservationLivePanel"><div id="reservationDashboardEmpty"></div><div id="reservationDashboardContent"><section id="reservationHero" class="rd-hero"></section><section class="rd-control-card"><div id="reservationModeControls" class="rd-mode-controls"></div></section><div class="rd-grid"><div class="rd-column"><section class="rd-card"><div id="reservationBookingList" class="rd-booking-list"></div></section><section id="reservationTransition"><span data-transition-title></span><div id="reservationTransitionList"></div></section></div><aside class="rd-column"><div id="reservationQuotaCard"></div><div id="reservationMonitorCard"></div><section class="rd-card"><div id="reservationQuickControls" class="rd-quick-controls"></div></section><section class="rd-card"><div id="reservationSettingControls" class="rd-settings"></div></section></aside></div></div></div>
    <div id="reservationLegacyPanel" hidden><div id="pianoRoomsGrid"></div></div>
  </section></div></body></html>`);

  await page.evaluate((row) => {
    const writes = [];
    window.__dashboardWrites = writes;
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: row.user_id } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from(table) {
        if (table === 'reservation_monitor_state') {
          const builder = {
            select() { return builder; }, eq() { return builder; },
            order: async () => ({ data: [row], error: null }),
          };
          return builder;
        }
        return {
          insert(value) {
            writes.push(value);
            return { select() { return { single: async () => ({ data: { id: 'command-1' }, error: null }) }; } };
          },
        };
      },
      channel() { return { on() { return this; }, subscribe() { return this; } }; },
      removeChannel: async () => {},
    };
    window.getSB = () => client;
  }, sampleRow);
  await page.addScriptTag({ url: 'http://127.0.0.1:4173/reservation-dashboard.js?v=372' });

  await expect(page.locator('#reservationHero')).toHaveText(/Aula (113|308)/);
  await expect(page.locator('#reservationModeControls .active')).toContainText('Grabación');
  await expect(page.locator('#reservationBookingList')).toContainText('Aula 308');
  await expect(page.locator('#reservationQuotaCard')).toContainText('105');
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) {
    await page.screenshot({ path: 'test-results/reservation-dashboard-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: 'test-results/reservation-dashboard-mobile.png', fullPage: true });
  }

  await page.locator('[data-command="set_migration"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites[0])).toMatchObject({
    source: 'alberto', command: 'set_migration', payload: { enabled: true },
  });

  await page.getByRole('button', { name: 'Piano Rooms' }).click();
  await expect(page.locator('#reservationLegacyPanel')).not.toHaveAttribute('hidden', '');
  await expect(page.locator('#reservationLivePanel')).toHaveAttribute('hidden', '');
});
