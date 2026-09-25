import { expect, test } from '@playwright/test';

test.beforeEach(async({page})=>{ await page.route('**/supabase-sdk-v2-116-0.js',route=>route.fulfill({status:200,contentType:'text/javascript',body:'/* SDK transport isolated by this suite */'})); });

const ipadUA = 'Mozilla/5.0 (iPad; CPU OS 17_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Mobile/15E148 Safari/604.1';
test.use({ userAgent: ipadUA, hasTouch: true });

async function boot(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'MacIntel' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 5 });
    const now = new Date();
    const date = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
    const fixture = {
      obras: [{ id: 'bach', name: 'Bach · Preludio', composer: 'J. S. Bach', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }],
      eventos: [], sesiones: [], registro: [], forestPlants: [], dailyJournalEntries: [],
      sessionPlants: [{ id: 'today-75', obraId: 'bach', startedAt: new Date(now.getTime() - 75 * 60000).toISOString(), endedAt: now.toISOString(), mins: 75 }],
    };
    localStorage.setItem('alberto_piano_v2', JSON.stringify(fixture));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
    const row = { user_id: '00000000-0000-4000-8000-000000000001', source: 'alberto', observed_at: now.toISOString(), heartbeat_at: now.toISOString(), updated_at: now.toISOString(),
      state: { date, reservations: [{ event_id: 1, room: '113', start: '00:00', end: '23:59', type: 'Einzelbuchung' }, { event_id: 2, room: '308', start: '18:00', end: '20:00', type: 'VIP', locked: true }],
        quota: { rf_mins: 90, sz_mins: 60, sz_applicable: true }, monitor: { online: true, paused: false, operating_mode: { code: '2', name: 'Grabación' }, min_slot_duration: 45 } } };
    window.__reservationReads = 0;
    window.__reservationWrites = [];
    window.__reservationState = { rows: [row], error: null, signedIn: true };
    const builder = () => {
      const value = { select() { return value; }, eq() { return value; }, order: async () => ({ data: [], error: null }), maybeSingle: async () => ({ data: null, error: null }), single: async () => ({ data: null, error: null }), insert() { return value; }, update() { return value; }, upsert() { return value; }, delete() { return value; }, then(resolve) { return Promise.resolve({ data: null, error: null }).then(resolve); } };
      return value;
    };
    const client = {
      auth: { getSession: async () => ({ data: { session: window.__reservationState.signedIn ? { user: { id: row.user_id } } : null } }), onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }) },
      from(table) {
        const value = builder();
        if (table === 'reservation_monitor_state') value.order = async () => { window.__reservationReads++; return { data: window.__reservationState.rows, error: window.__reservationState.error }; };
        if (table === 'reservation_monitor_commands') value.insert = command => { window.__reservationWrites.push(command); return { select: () => ({ single: async () => ({ data: { id: 'test-command' }, error: null }) }) }; };
        return value;
      },
      channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel: async () => {}, rpc: async () => ({ data: null, error: null }),
    };
    window.supabase = { createClient: () => client };
  });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* Local fixture */' }));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('#reservationHero')).toContainText('Aula 113');
  await expect(page.locator('.ipad-today-next')).toBeVisible();
  await expect(page.locator('html')).toHaveClass(/platform-ipad/);
  await expect(page.locator('html')).not.toHaveClass(/platform-windows/);
  await expect(page.locator('#splashScreen')).toBeHidden();
}

for (const viewport of [{ width: 834, height: 1194, name: 'vertical' }, { width: 1194, height: 834, name: 'horizontal' }]) {
  test(`Hoy en iPad ${viewport.name}: contenido legible y controles conservados`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await boot(page);
    await expect(page.locator('#sessionConcentradoText')).toContainText(/1\s*h\s*15\s*min/);
    const boxes = await Promise.all(['#sessionResumenCard', '.ipad-today-next', '.ipad-today-access', '#sessionAulasDashboard'].map(selector => page.locator(selector).boundingBox()));
    for (let i = 0; i < boxes.length; i++) {
      expect(boxes[i].x).toBeGreaterThanOrEqual(0);
      expect(boxes[i].x + boxes[i].width).toBeLessThanOrEqual(viewport.width);
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        expect(a.x + a.width <= b.x + 1 || b.x + b.width <= a.x + 1 || a.y + a.height <= b.y + 1 || b.y + b.height <= a.y + 1).toBe(true);
      }
    }
    await expect(page.getByText('focos pendientes', { exact: false })).toHaveCount(0);
    await expect(page.locator('#reservationModeControls')).toBeHidden();
    await page.locator('.ipad-today-monitor > summary').click();
    await expect(page.locator('#reservationModeControls .active')).toContainText('Grabación');
    await page.locator('[data-command="set_migration"]').click();
    expect(await page.evaluate(() => window.__reservationWrites[0])).toMatchObject({ source: 'alberto', command: 'set_migration', payload: { enabled: true } });
    await page.locator('.ipad-today-monitor > summary').click();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (process.env.CAPTURE_IPAD_TODAY) {
      await page.evaluate(() => ReservationDashboard.refresh(false));
      await page.screenshot({ path: `test-results/ipad-hoy-${viewport.name}.png` });
      await page.screenshot({ path: `test-results/ipad-hoy-${viewport.name}-completa.png`, fullPage: true });
    }
    await page.locator('[data-ipad-today-register]').click();
    await expect(page.locator('.session-quick-disclosure')).toHaveAttribute('open', '');
    await expect(page.locator('#sessionQuickStudyObra')).toBeFocused();
    await page.locator('.ipad-today-access').getByRole('button', { name: /Premios/ }).click();
    await expect(page.locator('#view-premios')).toBeVisible();
    await expect(page.locator('.ipad-today-access')).toBeHidden();
    await page.evaluate(() => showView('session'));
    await page.locator('.ipad-today-access').getByRole('button', { name: /Deutsch/ }).click();
    await expect(page.locator('#view-deutsch')).toBeVisible();
  });
}

test('Aulas explica los fallos, conserva las reservas y consulta al volver', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await boot(page);
  await page.evaluate(async () => { window.__reservationState.error = { message: 'Sin red' }; await ReservationDashboard.refresh(true); });
  await expect(page.locator('#reservationHero')).toContainText('Aula 113');
  await expect(page.locator('#reservationDashboardStatus')).toContainText('Sin red');
  await page.clock.install();
  await page.clock.fastForward(16000);
  await expect(page.locator('#reservationDashboardStatus')).toContainText('Sin red');
  const before = await page.evaluate(() => window.__reservationReads);
  await page.evaluate(() => { window.__reservationState.error = null; document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => window.__reservationReads)).toBeGreaterThan(before);
  await expect(page.locator('#reservationDashboardStatus')).toContainText('En directo');
  await page.evaluate(async () => {
    window.__reservationState.rows[0].heartbeat_at = '2026-09-08T21:42:47Z';
    window.__reservationState.rows[0].state.monitor.online = false;
    await ReservationDashboard.refresh(false);
  });
  await expect(page.locator('#reservationConnectionHelp')).toContainText('completa su arranque en Telegram');
  await expect(page.locator('#reservationModeControls button').first()).toBeDisabled();
  await page.evaluate(async () => { window.__reservationState.signedIn = false; await ReservationDashboard.refresh(false); });
  await expect(page.locator('#reservationDashboardEmpty')).toContainText('Falta iniciar sesión');
  await page.clock.fastForward(16000);
  await expect(page.locator('#reservationDashboardEmpty')).toContainText('Falta iniciar sesión');
  await page.evaluate(async () => { window.__reservationState.signedIn = true; window.__reservationState.rows = []; window.__reservationState.error = { message: 'Sin red' }; await ReservationDashboard.refresh(false); });
  await expect(page.locator('#reservationDashboardEmpty')).toContainText('No se pudo conectar');
  await page.evaluate(async () => { window.__reservationState.error = null; await ReservationDashboard.refresh(false); });
  await expect(page.locator('#reservationDashboardEmpty')).toContainText('completa su arranque en Telegram');
});
