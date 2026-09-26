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

async function mountDashboard(page, row) {
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
    // Fila mutable desde la prueba: cada refresh devuelve su estado actual.
    window.__row = row;
    const client = {
      auth: {
        getSession: async () => ({ data: { session: { user: { id: row.user_id } } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      },
      from(table) {
        if (table === 'reservation_monitor_state') {
          const builder = {
            select() { return builder; }, eq() { return builder; },
            order: async () => ({ data: [window.__row], error: null }),
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
  }, row);
  await page.addScriptTag({ url: 'http://127.0.0.1:4173/reservation-dashboard.js?v=372' });
}

test('renders live reservations and sends a safe monitor command', async ({ page }) => {
  await mountDashboard(page, sampleRow);
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

test('distinguishes a stopped monitor and stale Asimut data from a live one', async ({ page }) => {
  const minutesAgo = minutes => new Date(Date.now() - minutes * 60 * 1000).toISOString();
  // Programa abierto (latido reciente) pero el bucle cayó: monitor.online=false.
  const stopped = structuredClone(sampleRow);
  stopped.observed_at = minutesAgo(12);
  stopped.state.monitor.online = false;
  await mountDashboard(page, stopped);
  await expect(page.locator('#reservationDashboardStatus')).toContainText('Monitor detenido');
  await expect(page.locator('#reservationHero')).toContainText('No está leyendo Asimut');
  await expect(page.locator('#reservationMonitorCard')).toContainText('detenido');
  await expect(page.locator('#reservationModeControls button').first()).toBeDisabled();

  // Latido reciente y bucle vivo, pero la última lectura de Asimut es antigua.
  await page.evaluate(async (at) => {
    const row = window.__row;
    row.observed_at = at;
    row.state.monitor.online = true;
    await window.ReservationDashboard.refresh(false);
  }, minutesAgo(9));
  await expect(page.locator('#reservationDashboardStatus')).toContainText('última lectura de Asimut hace 9 min');
  await expect(page.locator('#reservationDashboardStatus')).toHaveAttribute('data-kind', 'stale');
  await expect(page.locator('#reservationConnectionHelp')).toBeVisible();
  await expect(page.locator('#reservationModeControls button').first()).toBeEnabled();

  // Lectura reciente: en directo y sin aviso.
  await page.evaluate(async () => {
    window.__row.observed_at = new Date().toISOString();
    await window.ReservationDashboard.refresh(false);
  });
  await expect(page.locator('#reservationDashboardStatus')).toContainText('En directo');
  await expect(page.locator('#reservationConnectionHelp')).toBeHidden();
});

test('shows a failing monitor with its error and never mistakes missing data for a free agenda', async ({ page }) => {
  const now = new Date().toISOString();
  // Estado mínimo: el monitor cayó antes de su primera lectura (login roto).
  const failing = structuredClone(sampleRow);
  failing.observed_at = now;
  failing.state = {
    last_read_at: null, date: null, reservations: [], transition: null, scans: [], success_rate: '100%',
    quota: { rf_mins: 0, sz_mins: 0, sz_applicable: false },
    monitor: {
      online: false, paused: false, operating_mode: { code: '1', name: 'Normal' },
      error: { kind: 'ModuleNotFoundError', message: "No module named 'selenium.webdriver.chrome.webdriver'", attempt: 47, at: now, retry_in_s: 60 },
    },
  };
  await mountDashboard(page, failing);
  await expect(page.locator('#reservationDashboardStatus')).toContainText('El monitor está fallando · intento 47');
  await expect(page.locator('#reservationDashboardStatus')).toContainText('ninguna en esta sesión');
  await expect(page.locator('#reservationHero')).toContainText('No consigue leer Asimut');
  await expect(page.locator('#reservationHero')).toContainText('Intento 47 · ModuleNotFoundError');
  await expect(page.locator('#reservationHero')).toContainText('reintenta en 60 s');
  await expect(page.locator('#reservationBookingList')).toContainText('Sin datos todavía');
  await expect(page.locator('#reservationBookingList')).not.toContainText('Agenda despejada');
  await expect(page.locator('#reservationQuotaCard')).toContainText('Sin lectura de Asimut');
  await expect(page.locator('#reservationMonitorCard')).toContainText('fallando');
  await expect(page.locator('#reservationModeControls button').first()).toBeDisabled();

  // Caída tras lecturas buenas: conserva las reservas y la hora real de lectura.
  await page.evaluate(async () => {
    const readAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    Object.assign(window.__row.state, {
      last_read_at: readAt,
      date: new Date().toISOString().slice(0, 10),
      reservations: [{ event_id: 7, start: '10:00', end: '12:00', room: '30113', type: '', status: 'upcoming', locked: false, confirmed: false }],
    });
    window.__row.state.monitor.error.attempt = 2;
    await window.ReservationDashboard.refresh(false);
  });
  await expect(page.locator('#reservationDashboardStatus')).toContainText('intento 2 · última lectura de Asimut: hace 20 min');
  await expect(page.locator('#reservationBookingList')).toContainText('Aula 30.113');
  await expect(page.locator('#reservationBookingList')).not.toContainText('30113');
});
