import { test, expect } from '@playwright/test';

function fixture() {
  return {
    obras: [],
    eventos: [{
      id: 'ev_existing_manual',
      tipo: 'examen',
      fecha: '2026-09-22',
      fechaFin: '2026-09-22',
      nombre: 'Examen existente',
      obras: [],
      estado: 'planificado',
    }],
    sesiones: [], registro: [], sessionPlants: [], forestPlants: [],
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
  }, fixture());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.EventDataProtection), { timeout: 15000 }).toBe(true);
}

test('migrates current manual events to protected records', async ({ page }) => {
  await prepare(page);
  const state = await page.evaluate(() => ({
    event: db.eventos.find(ev => ev.id === 'ev_existing_manual'),
    migration: db.eventProtectionMigration,
  }));
  expect(state.event.planningProtected).toBe(true);
  expect(state.event.dataProtection).toBe('manual-event-v1');
  expect(state.event.createdAt).toBeTruthy();
  expect(state.migration).toBe('manual-event-protection-v1');
});

test('new manual event is protected and intentional deletion creates a tombstone', async ({ page }) => {
  await prepare(page);

  await page.evaluate(() => {
    if (typeof openAddEvento === 'function') openAddEvento();
    document.getElementById('eventoNombre').value = 'Evento manual protegido';
    document.getElementById('eventoFecha').value = '2026-10-02';
    const end = document.getElementById('eventoFechaFin');
    if (end) end.value = '2026-10-02';
    if (typeof selectEventoTipo === 'function') {
      const button = document.querySelector('[data-evento-tipo="examen"], .evento-tipo-btn.examen');
      selectEventoTipo('examen', button || undefined);
    }
    saveEvento();
  });

  const created = await expect.poll(async () => page.evaluate(() => {
    const ev = db.eventos.find(item => item.nombre === 'Evento manual protegido');
    return ev ? {
      id: ev.id,
      planningProtected: ev.planningProtected,
      manualSaved: ev.manualSaved,
      dataProtection: ev.dataProtection,
      updatedAt: ev.updatedAt,
    } : null;
  })).not.toBeNull();

  const event = await page.evaluate(() => {
    const ev = db.eventos.find(item => item.nombre === 'Evento manual protegido');
    return {
      id: ev.id,
      planningProtected: ev.planningProtected,
      manualSaved: ev.manualSaved,
      dataProtection: ev.dataProtection,
      updatedAt: ev.updatedAt,
    };
  });
  expect(event.planningProtected).toBe(true);
  expect(event.manualSaved).toBe(true);
  expect(event.dataProtection).toBe('manual-event-v1');
  expect(event.updatedAt).toBeTruthy();

  await page.evaluate(id => {
    window.confirm = () => true;
    deleteEvento(id);
  }, event.id);

  const deleted = await page.evaluate(id => ({
    exists: db.eventos.some(ev => String(ev.id) === String(id)),
    tombstone: (db.planningEventTombstones || []).map(String).includes(String(id)),
  }), event.id);
  expect(deleted.exists).toBe(false);
  expect(deleted.tombstone).toBe(true);
});
