import fs from 'node:fs';
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

// El montaje usa el marcado real de index.html: la pantalla Aulas y la
// tarjeta resumen de Hoy, para que la prueba no se desfase del diseño.
const indexHtml = fs.readFileSync('index.html', 'utf8');
const aulasView = indexHtml.match(/<div class="view" id="view-aulas">[\s\S]*?\r?\n<\/div>\r?\n/)[0].replace('class="view"', 'class="view active"');
const todayCard = indexHtml.match(/<button type="button" class="aulas-today-card"[\s\S]*?<\/button>/)[0];

async function mountDashboard(page, row) {
  await page.goto('/reservation-dashboard.css?v=479');
  await page.setContent(`<!doctype html><html lang="es" data-theme="marmol"><head>
    <link rel="stylesheet" href="http://127.0.0.1:4173/styles.css?v=464">
    <link rel="stylesheet" href="http://127.0.0.1:4173/reservation-dashboard.css?v=479">
  </head><body data-view="aulas">${todayCard}${aulasView}</body></html>`);

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
            order: async () => ({ data: window.__rows || [window.__row], error: null }),
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
  await page.addScriptTag({ url: 'http://127.0.0.1:4173/reservation-dashboard.js?v=479' });
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
    await page.setViewportSize({ width: 1280, height: 720 });
  }

  await page.locator('[data-command="set_migration"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites[0])).toMatchObject({
    source: 'alberto', command: 'set_migration', payload: { enabled: true },
  });

  await page.getByRole('tab', { name: 'Piano Rooms' }).click();
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

const awaitingRow = () => {
  const now = new Date().toISOString();
  const awaiting = structuredClone(sampleRow);
  awaiting.observed_at = now;
  awaiting.state = {
    last_read_at: null, date: null, reservations: [], transition: null, scans: [], success_rate: '100%',
    quota: { rf_mins: 0, sz_mins: 0, sz_applicable: false },
    monitor: { online: false, phase: 'awaiting_start', paused: true, operating_mode: { code: '1', name: 'sin elegir' }, aachen_only: false },
    startup: {
      mode: null, inicio: '1000', restore: null, previous_available: true,
      previous: {
        saved_at: now, blind_periods: [['13:00', '14:00']], blinded_rooms: [30113], blinded_groups: [4],
        priority_rooms: [113], no_rebook_count: 2,
      },
      inicio_options: ['off', '1000', '1030', '1100'],
    },
  };
  return awaiting;
};

test('starts with one tap repeating the last mode, and every option stays one tap away', async ({ page }) => {
  await mountDashboard(page, awaitingRow());
  // Lo último con lo que estuvo en marcha (lo recuerda este dispositivo).
  await page.evaluate(async () => {
    localStorage.setItem('reservationDashboardLastStart_alberto', JSON.stringify({ mode: '3' }));
    await window.ReservationDashboard.refresh(false);
  });
  const panel = page.locator('#reservationStartupPanel');
  await expect(page.locator('#reservationHero')).toContainText('Listo para arrancar');
  await expect(page.locator('#reservationDashboardStatus')).toContainText('esperando arranque');
  await expect(page.locator('.rd-controlbar')).toBeHidden();
  // Hora elegida en Telegram (10:00) + modo recordado + recuperar ajustes (6 elementos).
  await expect(panel.locator('.rd-start-summary')).toContainText('Solo G5 · 10:00 · Köln');
  await expect(panel.locator('.rd-start-summary')).toContainText('Recupera los ajustes de la sesión anterior (6)');
  await expect(panel.locator('#reservationStartupOptions')).toBeHidden();
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) {
    for (const [name, width, height] of [['desktop', 1280, 900], ['ipad', 834, 1112], ['mobile', 390, 844]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `test-results/aulas-startup-${name}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1280, height: 720 });
  }
  await panel.locator('[data-startup-command="start_monitor"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites[0])).toMatchObject({
    command: 'start_monitor', payload: { mode: '3', inicio: '1000', restore: 'yes', aachen: false },
  });
});

test('starts the monitor from the app with the same menu as Telegram', async ({ page }) => {
  await mountDashboard(page, awaitingRow());
  const panel = page.locator('#reservationStartupPanel');
  // Sin nada recordado: Normal, la hora de Telegram y recuperar ajustes.
  await expect(panel.locator('.rd-start-summary')).toContainText('Normal · 10:00 · Köln');
  await panel.locator('[data-ui="toggle-startup-options"]').click();
  const options = panel.locator('#reservationStartupOptions');
  await expect(options).toBeVisible();
  await expect(options.locator('[data-startup-field="inicio"].active')).toHaveText('10:00');
  await expect(options).toContainText('13:00–14:00');
  await expect(options).toContainText('30.113');
  await expect(options).toContainText('G4');

  await options.locator('[data-startup-field="mode"][data-value="2"]').click();
  await expect(options.locator('[data-startup-field="mode"][data-value="2"]')).toHaveClass(/active/);
  await options.locator('[data-startup-field="restore"][data-value="no"]').click();
  await options.locator('[data-startup-field="inicio"][data-value="off"]').click();
  await expect(panel.locator('.rd-start-summary')).toContainText('Grabación · Ahora · Köln');
  await expect(panel.locator('.rd-start-summary')).toContainText('Empieza limpio');
  await panel.locator('[data-startup-command="start_monitor"]').click();
  const writes = await page.evaluate(() => window.__dashboardWrites);
  expect(writes.slice(0, 3).map(w => [w.command, w.payload])).toEqual([
    ['startup_select', { mode: '2' }],
    ['startup_select', { restore: 'no' }],
    ['startup_select', { inicio: 'off' }],
  ]);
  expect(writes[3]).toMatchObject({ command: 'start_monitor', payload: { mode: '2', inicio: 'off', restore: 'no', aachen: false } });

  // Cerrar sin iniciar pide confirmación.
  await page.evaluate(() => { window.__dashboardWrites.length = 0; });
  await page.evaluate(async () => { await window.ReservationDashboard.refresh(false); });
  await panel.locator('[data-ui="ask-cancel-start"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites.length)).toBe(0);
  await panel.locator('[data-startup-command="cancel_start"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites[0])).toMatchObject({ command: 'cancel_start', payload: {} });

  // Arrancando y, al llegar la primera lectura, el panel normal.
  await page.evaluate(async () => {
    window.__row.state.monitor.phase = 'starting';
    await window.ReservationDashboard.refresh(false);
  });
  await expect(page.locator('#reservationHero')).toContainText('Entrando en Asimut');
  await page.evaluate(async (running) => {
    window.__row = running;
    await window.ReservationDashboard.refresh(false);
  }, sampleRow);
  await expect(panel).toBeHidden();
  await expect(page.locator('.rd-controlbar')).toBeVisible();
});

test('closes a running monitor only after confirming and shows its active settings', async ({ page }) => {
  const running = structuredClone(sampleRow);
  running.state.monitor.phase = 'running';
  running.state.monitor.blind_periods = [['12:00', '12:30']];
  running.state.monitor.blinded_rooms = [204];
  await mountDashboard(page, running);
  const settings = page.locator('#reservationActiveSettings');
  await expect(settings).toContainText('12:00–12:30');
  await expect(settings).toContainText('G4');
  await expect(settings).toContainText('113, 308');
  await expect(page.locator('#reservationSettingControls')).toContainText('Rellena huecos de última hora');

  await page.locator('[data-ui="ask-shutdown"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites.length)).toBe(0);
  await expect(page.locator('#reservationDangerControls')).toContainText('¿Cerrar el monitor?');
  await page.locator('[data-command="shutdown"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites[0])).toMatchObject({ command: 'shutdown', payload: {} });

  // Cierre publicado por el monitor: «cerrado», no «sin señal», aunque el latido sea viejo.
  await page.evaluate(async () => {
    window.__row.state.monitor.phase = 'closed';
    window.__row.state.monitor.online = false;
    window.__row.heartbeat_at = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await window.ReservationDashboard.refresh(false);
  });
  await expect(page.locator('#reservationHero')).toContainText('Cerrado sin errores');
  await expect(page.locator('#reservationMonitorCard')).toContainText('cerrado');
  await expect(page.locator('#reservationBookingList')).toContainText('Aula 113');
  await expect(page.locator('#aulasTodayCard')).toContainText('Monitor cerrado');
});

test('on the phone your reservations come first: day bar, today, tomorrow, then fixed controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const running = structuredClone(sampleRow);
  running.state.reservations[0] = { ...running.state.reservations[0], start: '00:00', end: '23:59' };
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowIso = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  running.state.transition = { date: tomorrowIso, reservations: [{ event_id: 93, start: '11:00', end: '12:30', room: '30204', type: 'Einzelbuchung', status: 'upcoming', locked: false, confirmed: false }], quota: { rf_mins: 0, sz_mins: 0, sz_applicable: true } };
  await mountDashboard(page, running);
  // Barra inferior del móvil v2 (la mide mobile-v2.js en la app real).
  await page.evaluate(() => {
    document.documentElement.classList.add('mobile-v2');
    document.body.classList.add('mv2-nav-visible');
    document.documentElement.style.setProperty('--mv2-nav-h', '64px');
    const nav = document.createElement('nav');
    nav.style.cssText = 'position:fixed;left:0;right:0;bottom:0;height:64px;background:#fff;border-top:1px solid #ddd';
    document.body.appendChild(nav);
  });
  await expect(page.locator('#aulasTodayCard')).toContainText('Aula 113 · hasta 23:59');

  // Lo primero de la pantalla: la línea del día y tus reservas.
  await expect(page.locator('#reservationHero')).toBeHidden();
  await expect(page.locator('#reservationDayBar .rd-daybar-block')).toHaveCount(2);
  await expect(page.locator('#reservationAgendaTitle')).toContainText('Hoy');
  await expect(page.locator('#reservationAgendaMeta')).toContainText('2 reservas');
  // La otra reserva del ejemplo (15:30–17:00) también está en curso si la prueba corre a esa hora.
  await expect(page.locator('#reservationBookingList .rd-booking.is-current', { hasText: 'Aula 113' }).locator('.rd-booking-progress')).toBeVisible();
  await expect(page.locator('#reservationTransition')).toContainText('Mañana');
  await expect(page.locator('#reservationTransition')).toContainText('Aula 30.204');
  const screenTop = (await page.locator('#aulasDashboard').boundingBox()).y;
  const listTop = (await page.locator('#reservationBookingList').boundingBox()).y;
  expect(listTop - screenTop).toBeLessThan(200);

  // Controles fijos encima de la navegación.
  const bar = await page.locator('.rd-controlbar').boundingBox();
  expect(bar.y + bar.height).toBeLessThanOrEqual(844 - 64);
  expect(bar.y + bar.height).toBeGreaterThan(844 - 64 - 30);
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) await page.screenshot({ path: 'test-results/aulas-running-mobile.png' });

  // Monitor y Ajustes en pestañas; las reservas siguen a la vista.
  await expect(page.locator('#reservationSettingControls')).toBeHidden();
  await page.locator('[data-rd-tab="ajustes"]').click();
  await expect(page.locator('#reservationSettingControls')).toBeVisible();
  await expect(page.locator('#reservationBookingList')).toBeVisible();

  // El modo se cambia desde la barra: la lista se abre hacia arriba.
  const toggle = page.locator('#reservationModeToggle');
  await expect(toggle).toContainText('Grabación');
  await expect(page.locator('#reservationModeControls')).toBeHidden();
  await toggle.click();
  await expect(page.locator('#reservationModeControls')).toBeVisible();
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) await page.screenshot({ path: 'test-results/aulas-mode-mobile.png' });
  await page.locator('#reservationModeControls [data-mode="1"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'set_operating_mode', payload: { mode: '1' } });
  await expect(page.locator('#reservationModeControls')).toBeHidden();
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: 'test-results/aulas-running-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 834, height: 1112 });
    await page.screenshot({ path: 'test-results/aulas-running-ipad.png', fullPage: true });
  }
});

test('launches the quota lab from Ajustes and shows its conclusions', async ({ page }) => {
  const running = structuredClone(sampleRow);
  running.state.quota_lab = {
    status: 'done', finished_at: new Date().toISOString(), progress: 'Guardado',
    questions: [
      { id: 'horizonte', title: 'El tramo gratis va del cuarto actual a +2 h', verdict: 'yes', text: 'Ahora es gratis hasta las 11:00.' },
      { id: 'sz_lineal', title: 'SZ: al cruzar 10:00/15:00 solo pagas lo de dentro', verdict: 'unknown', text: 'Hace falta SZ libre.' },
    ],
    tests: [{ id: 'SZ_EXACTA', day: new Date().toISOString().slice(0, 10), ini: '10:00', fin: '11:00', min: 60, sz: false, rf: false, codes: [] }],
  };
  await mountDashboard(page, running);
  const lab = page.locator('#reservationQuotaLab');
  await expect(lab).toContainText('sin reservar nada');
  await expect(lab.locator('li.is-yes')).toContainText('Ahora es gratis hasta las 11:00');
  await expect(lab.locator('li.is-unknown')).toContainText('Hace falta SZ libre');
  await expect(lab).toContainText('1 simulaciones');
  await lab.locator('[data-command="run_quota_lab"]').click();
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'run_quota_lab', payload: {} });

  // Mientras corre, el botón se desactiva y se ve el progreso.
  await page.evaluate(async () => {
    window.__row.state.quota_lab = { status: 'running', progress: 'Cuotas: …', questions: [], tests: [] };
    await window.ReservationDashboard.refresh(false);
  });
  await expect(lab).toContainText('En marcha… Cuotas: …');
  await expect(lab.locator('[data-command="run_quota_lab"]')).toBeDisabled();
});

test('«reciclar cuota» del laboratorio pide confirmación antes de tocar una reserva', async ({ page }) => {
  const row = structuredClone(sampleRow);
  row.state.quota_lab = { status: 'done', finished_at: new Date().toISOString(), questions: [], tests: [] };
  await mountDashboard(page, row);
  const lab = page.locator('#reservationQuotaLab');
  await lab.getByRole('button', { name: /reciclar cuota/ }).click();
  await expect(lab.locator('.rd-lab-warn')).toContainText('Esto sí toca Asimut');
  await lab.getByRole('button', { name: 'Cancelar' }).click();
  await expect(lab.locator('.rd-lab-warn')).toHaveCount(0);
  const writes = await page.evaluate(() => window.__dashboardWrites.length);
  await lab.getByRole('button', { name: /reciclar cuota/ }).click();
  await lab.getByRole('button', { name: 'Sí, probar reciclar' }).click();
  expect(await page.evaluate(() => window.__dashboardWrites.length)).toBe(writes + 1);
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'run_quota_lab', payload: { reciclar: true } });
});

test('tus reservas se cambian desde la app: ±15, candado y cancelar con confirmación', async ({ page }) => {
  // Mañana: todas las reservas son «próximas» sea la hora que sea.
  const tomorrow = new Date(Date.now() + 86400000);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const row = structuredClone(sampleRow);
  row.state.date = day;
  row.state.monitor.target_date = day;
  row.state.monitor.phase = 'running';
  await mountDashboard(page, row);
  const list = page.locator('#reservationBookingList');
  const writes = () => page.evaluate(() => window.__dashboardWrites.at(-1));

  // La barra: cada reserva es un botón; tocarlo abre su editor.
  await page.locator('#reservationDayBar .rd-daybar-block').first().click();
  const editor = list.locator('.rd-edit[data-edit-for="91"]');
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('button', { name: 'Guardar en Asimut' })).toBeDisabled();
  await editor.getByRole('button', { name: 'Inicio 15 min después' }).click();
  await editor.getByRole('button', { name: 'Fin 15 min después' }).click();
  await expect(list.locator('.rd-edit-diff')).toContainText('10:15–12:15');
  await expect(page.locator('#reservationDayBar .rd-daybar-ghost')).toHaveCount(1);
  await list.getByRole('button', { name: 'Guardar en Asimut' }).click();
  expect(await writes()).toMatchObject({ command: 'reservation_modify', payload: { event_id: 91, start: '10:15', end: '12:15' } });
  await expect(list.locator('.rd-edit')).toHaveCount(0);

  // Protegida: no se mueve ni se cancela hasta quitar el candado.
  await list.locator('[data-edit-open="92"]').click();
  const locked = list.locator('.rd-edit[data-edit-for="92"]');
  await expect(locked).toContainText('Protegida con candado');
  await expect(locked.getByRole('button', { name: 'Fin 15 min después' })).toBeDisabled();
  await expect(locked.getByRole('button', { name: 'Cancelar reserva…' })).toBeDisabled();
  await locked.getByRole('button', { name: '🔓 Quitar candado' }).click();
  expect(await writes()).toMatchObject({ command: 'reservation_lock', payload: { event_id: 92, locked: false } });

  // Cancelar pide un segundo toque.
  await list.locator('[data-edit-open="92"]').click(); // cierra
  await list.locator('[data-edit-open="91"]').click();
  await list.getByRole('button', { name: 'Cancelar reserva…' }).click();
  await expect(list.locator('.rd-edit-danger')).toContainText('no se volverá a reservar solo');
  const before = await page.evaluate(() => window.__dashboardWrites.length);
  await list.getByRole('button', { name: 'No', exact: true }).click();
  expect(await page.evaluate(() => window.__dashboardWrites.length)).toBe(before);
  await list.getByRole('button', { name: 'Cancelar reserva…' }).click();
  await list.getByRole('button', { name: 'Sí, cancelar' }).click();
  expect(await writes()).toMatchObject({ command: 'reservation_cancel', payload: { event_id: 91 } });
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) await page.screenshot({ path: 'test-results/aulas-editar.png', fullPage: true });

  // Sin monitor conectado no se ofrece editar.
  await page.evaluate(async () => {
    window.__row.state.monitor.online = false;
    await window.ReservationDashboard.refresh(false);
  });
  await expect(list.locator('.rd-booking-edit')).toHaveCount(0);
});

test('vista mínima: solo la barra y la lista; el resto tras símbolos y «⋯»', async ({ page }) => {
  const row = structuredClone(sampleRow);
  row.state.monitor.phase = 'running';
  row.state.transition = { date: '2099-01-02', reservations: [{ event_id: 95, start: '11:00', end: '12:00', room: '113', type: 'Einzelbuchung' }] };
  await mountDashboard(page, row);
  const screen = page.locator('#aulasDashboard');
  await expect(page.locator('#reservationMiniBar')).toBeHidden();
  await page.getByRole('button', { name: 'Vista mínima' }).click();
  await expect(screen).toHaveClass(/is-minimal/);
  await expect(page.locator('#reservationMiniBar')).toContainText('RF 105 · SZ 75');
  await expect(page.locator('#reservationDayBar')).toBeVisible();
  await expect(page.locator('#reservationBookingList')).toBeVisible();
  for (const hidden of ['.rd-controlbar', '.rd-tabs', '.rd-panes', '#reservationQuotaCard', '#reservationTransition']) {
    await expect(page.locator(`#aulasDashboard ${hidden}`)).toBeHidden();
  }
  // Mañana y «⋯» despliegan lo oculto; ⏸ manda la orden sin abrir nada.
  await page.getByRole('button', { name: /Mañana/ }).click();
  await expect(page.locator('#reservationTransition')).toBeVisible();
  await page.getByRole('button', { name: 'Pausar el monitor' }).click();
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'pause' });
  await page.getByRole('button', { name: /Ver todo/ }).click();
  await expect(page.locator('#aulasDashboard .rd-controlbar')).toBeVisible();
  await expect(page.locator('#reservationQuotaCard')).toBeVisible();
  if (process.env.CAPTURE_RESERVATION_DASHBOARD) await page.screenshot({ path: 'test-results/aulas-minima-abierta.png', fullPage: true });
  await page.getByRole('button', { name: 'Ocultar el resto' }).click();
  await expect(page.locator('#aulasDashboard .rd-controlbar')).toBeHidden();
  // Se recuerda por dispositivo y se vuelve a la completa con el mismo botón.
  expect(await page.evaluate(() => localStorage.getItem('reservationDashboardView'))).toBe('minimal');
  await page.getByRole('button', { name: 'Vista completa' }).click();
  await expect(screen).not.toHaveClass(/is-minimal/);
  await expect(page.locator('#aulasDashboard .rd-controlbar')).toBeVisible();
});

test('Hoy: la línea del día abre el editor de esa franja sin salir de Hoy', async ({ page }) => {
  // Mañana: las dos reservas son «próximas» sea la hora que sea.
  const tomorrow = new Date(Date.now() + 86400000);
  const day = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
  const row = structuredClone(sampleRow);
  row.state.date = day;
  row.state.monitor.target_date = day;
  row.state.monitor.phase = 'running';
  await mountDashboard(page, row);
  // El hueco que deja la tarjeta de Aulas de Hoy (mobile-v2).
  await page.evaluate(() => {
    const box = document.createElement('div');
    box.className = 'aulas-screen rd-embed';
    box.id = 'mv2DayBar';
    document.body.prepend(box);
    window.__views = [];
    window.showView = view => window.__views.push(view);
    window.ReservationDashboard.paintHoy();
  });
  const bar = page.locator('#mv2DayBar');
  await expect(bar.locator('.rd-daybar-block')).toHaveCount(2);
  await expect(bar).toContainText('Toca una franja para cambiarla');
  await expect(bar.locator('.rd-daybar-legend')).toHaveCount(0);

  await bar.locator('[data-edit-open="91"]').click();
  const sheet = page.locator('#rdQuickSheet');
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Aula 113 · 10:00–12:00');
  await sheet.getByRole('button', { name: 'Fin 15 min después' }).click();
  await expect(sheet.locator('.rd-edit-diff')).toContainText('10:00–12:15');
  await expect(sheet.locator('.rd-daybar-ghost')).toHaveCount(1);
  await sheet.getByRole('button', { name: 'Guardar en Asimut' }).click();
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'reservation_modify', payload: { event_id: 91, start: '10:00', end: '12:15' } });
  await expect(sheet).toBeHidden();

  // ✕ cierra sin mandar nada.
  await bar.locator('[data-edit-open="92"]').click();
  await expect(sheet).toContainText('Protegida con candado');
  const before = await page.evaluate(() => window.__dashboardWrites.length);
  await sheet.getByRole('button', { name: 'Cerrar' }).click();
  await expect(sheet).toBeHidden();
  expect(await page.evaluate(() => window.__dashboardWrites.length)).toBe(before);

  // Sin el monitor en marcha no se puede cambiar: tocar abre Aulas.
  await page.evaluate(async () => { window.__row.state.monitor.online = false; await window.ReservationDashboard.refresh(false); });
  await expect(bar).not.toContainText('Toca una franja');
  await bar.locator('[data-edit-open="91"]').click();
  expect(await page.evaluate(() => window.__views)).toEqual(['aulas']);
  await expect(sheet).toBeHidden();
});

test('si el perfil recordado no da señal, Aulas muestra el monitor que sí está en marcha', async ({ page }) => {
  const alberto = structuredClone(sampleRow);
  alberto.heartbeat_at = alberto.observed_at = alberto.updated_at = new Date(Date.now() - 60 * 60000).toISOString();
  const emma = structuredClone(sampleRow);
  emma.source = 'emma';
  emma.state.reservations = [{ event_id: 501, start: '16:00', end: '17:30', room: '235', type: 'Einzelbuchung' }];
  await mountDashboard(page, alberto);
  await page.evaluate(async rows => {
    localStorage.setItem('reservationDashboardSource', 'alberto');
    window.__rows = rows;
    await window.ReservationDashboard.refresh(false);
  }, [alberto, emma]);
  const switcher = page.locator('#reservationSourceSwitch');
  await expect(switcher).toBeVisible();
  await expect(switcher.locator('button.active')).toContainText('Emma');
  await expect(page.locator('#reservationBookingList')).toContainText('Aula 235');
  // Elegir a mano sigue funcionando.
  await switcher.getByRole('button', { name: /Alberto/ }).click();
  await expect(switcher.locator('button.active')).toContainText('Alberto');
});

test('laboratorio de aulas: lanza con { aulas: true } y muestra la antelación aula por aula', async ({ page }) => {
  const row = structuredClone(sampleRow);
  row.source = 'emma';
  row.state.quota_lab = {
    status: 'done', finished_at: new Date().toISOString(),
    questions: [
      { id: 'aulas_total', title: 'Aulas de Emma: acceso', verdict: 'yes', text: 'Asimut deja reservar 2 de 3 aulas. Sin acceso: 1.' },
      { id: 'aulas_15 h', title: 'Antelación 15 h: 1 aulas', verdict: 'yes', text: '10.235' },
    ],
    tests: [
      { id: '10.235', day: '2099-01-02', ini: '12:00', fin: '12:15', min: 15, sz: false, rf: false, codes: ['15 h'] },
      { id: '30.113', day: '2099-01-02', ini: '12:00', fin: '12:15', min: 15, sz: true, rf: false, codes: ['no'] },
    ],
  };
  await mountDashboard(page, row);
  const lab = page.locator('#reservationQuotaLab');
  await expect(lab).toContainText('Asimut deja reservar 2 de 3 aulas');
  await lab.getByText('Ver aula por aula').click();
  await expect(lab.locator('tbody tr').first()).toContainText('15 h');
  await expect(lab.locator('tbody tr').nth(1)).toContainText('no');
  await lab.getByRole('button', { name: /Probar acceso a todas las aulas/ }).click();
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'run_quota_lab', payload: { aulas: true } });
});

test('tipo de reserva: Emma por defecto en grupo con Alberto, y se puede cambiar', async ({ page }) => {
  const row = structuredClone(sampleRow);
  row.source = 'emma';
  row.state.monitor.booking_type = 'grupo_alberto';
  await mountDashboard(page, row);
  await page.evaluate(() => { localStorage.setItem('reservationDashboardSource', 'emma'); });
  await page.evaluate(() => window.ReservationDashboard.refresh(false));
  const box = page.locator('#reservationSettingControls .rd-booking-type');
  await expect(box.getByRole('radio')).toHaveCount(3);
  await expect(box.getByRole('radio', { name: 'Grupo con Alberto' })).toHaveAttribute('aria-checked', 'true');
  await expect(box).toContainText('Alberto de participante');
  await box.getByRole('radio', { name: 'Anónima' }).click();
  expect(await page.evaluate(() => window.__dashboardWrites.at(-1))).toMatchObject({ command: 'set_booking_type', payload: { type: 'anon' } });
});

test('tipo de reserva: Alberto no tiene la opción de grupo', async ({ page }) => {
  const row = structuredClone(sampleRow);
  row.state.monitor.booking_type = 'anon';
  await mountDashboard(page, row);
  const box = page.locator('#reservationSettingControls .rd-booking-type');
  await expect(box.getByRole('radio')).toHaveCount(2);
  await expect(box.getByRole('radio', { name: 'Anónima' })).toHaveAttribute('aria-checked', 'true');
});
