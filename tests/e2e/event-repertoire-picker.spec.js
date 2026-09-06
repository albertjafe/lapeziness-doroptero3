import { test, expect } from '@playwright/test';

function work(index) {
  const composers = ['Beethoven', 'Schumann', 'Ravel', 'Bach', 'Tchaikovsky'];
  return {
    id: `work_${index}`,
    name: index === 37 ? 'Sonata Waldstein, Op. 53' : `Obra de prueba ${index}`,
    composer: index === 37 ? 'Beethoven' : composers[index % composers.length],
    tipo: 'obra',
    fase: 'activa',
    sol: 60,
    solHistory: [],
    movimientos: index === 37 ? [
      { id:'wald_1', name:'I. Allegro con brio' },
      { id:'wald_2', name:'II. Introduzione' },
      { id:'wald_3', name:'III. Rondo' },
    ] : [],
  };
}

function fixture() {
  return {
    obras: Array.from({ length: 80 }, (_, i) => work(i)),
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
  }, fixture());
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect.poll(() => page.evaluate(() => !!window.EventRepertoirePicker)).toBe(true);
  await expect.poll(() => page.evaluate(() => !!window.EventMovementSelector)).toBe(true);
  await page.evaluate(() => {
    renderObraCheckList(['work_2', 'work_37']);
    const modal = document.getElementById('modalAddEvento');
    modal.classList.add('active');
    modal.style.display = 'flex';
    EventRepertoirePicker.enhance({ reset: true });
    EventMovementSelector.render();
  });
}

test('event repertoire picker filters 80 works without losing checked selections', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await prepare(page);

  await expect(page.locator('#eventRepertoireSearch')).toHaveCount(1);
  await expect(page.locator('#obraCheckList .obra-check-item')).toHaveCount(80);
  await expect(page.locator('#obraCheckList input:checked')).toHaveCount(2);

  await page.locator('#eventRepertoireSearch').fill('Waldstein');
  await expect(page.locator('#obraCheckList .obra-check-item:not([hidden])')).toHaveCount(1);
  await expect(page.locator('#obraCheckList .obra-check-item:not([hidden])')).toContainText('Waldstein');
  await expect(page.locator('#obraCheckList input:checked')).toHaveCount(2);

  await page.locator('#eventRepertoireSearch').fill('Beethoven');
  const visible = page.locator('#obraCheckList .obra-check-item:not([hidden])');
  expect(await visible.count()).toBeGreaterThan(1);
  await expect(page.locator('#obraCheckList input:checked')).toHaveCount(2);

  await page.locator('#eventRepertoireSelectedOnly').click();
  const selectedVisible = page.locator('#obraCheckList .obra-check-item:not([hidden])');
  expect(await selectedVisible.count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('#obraCheckList input:checked')).toHaveCount(2);
});

test('a selected work starts with all movements and persists any subset', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await prepare(page);
  await expect.poll(() => page.evaluate(() => Boolean(window.saveEvento?.__eventMovementSelectorWrapped))).toBe(true);

  const buttons = page.locator('#obraCheckList .obra-check-item').filter({ hasText:'Waldstein' }).locator('[data-event-movement]');
  await expect(buttons).toHaveCount(3);
  await expect(page.locator('#obraCheckList .obra-check-item').filter({ hasText:'Waldstein' }).locator('[data-event-movement][aria-pressed="true"]')).toHaveCount(3);

  await page.evaluate(() => {
    closeModal('modalAddEvento');
    db.eventos.push({
      id:'event_movements', nombre:'Clase Waldstein', tipo:'clase', fecha:'2026-10-01', fechaFin:'',
      obras:['work_37'], rondas:[],
      repertorioPlanificado:[{ obraId:'work_37', movimientoId:null, uso:'general', notas:'' }],
    });
    openEditEvento('event_movements');
  });

  const editRow = page.locator('#obraCheckList .obra-check-item').filter({ hasText:'Waldstein' });
  await expect(editRow.locator('[data-event-movement]')).toHaveCount(3);
  await expect(editRow.locator('[data-event-movement][aria-pressed="true"]')).toHaveCount(3);

  await editRow.locator('[data-event-movement="wald_2"]').click();
  await expect(editRow.locator('[data-event-movement][aria-pressed="true"]')).toHaveCount(2);

  await page.evaluate(() => saveEvento());
  await expect.poll(() => page.evaluate(() => {
    const event = db.eventos.find(item => item.id === 'event_movements');
    return {
      movements:event?.professorMovements?.work_37 || [],
      relations:(event?.repertorioPlanificado || []).filter(rel => rel.obraId === 'work_37').map(rel => rel.movimientoId),
    };
  })).toEqual({ movements:['wald_1','wald_3'], relations:['wald_1','wald_3'] });

  await page.evaluate(() => openEditEvento('event_movements'));
  const reopened = page.locator('#obraCheckList .obra-check-item').filter({ hasText:'Waldstein' });
  await expect(reopened.locator('[data-event-movement][aria-pressed="true"]')).toHaveCount(2);
  await expect(reopened.locator('[data-event-movement="wald_2"]')).toHaveAttribute('aria-pressed', 'false');
});

test('iPad event modal is wider and repertoire uses two columns', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await prepare(page);

  const geometry = await page.evaluate(() => {
    const modal = document.querySelector('#modalAddEvento .evento-modal').getBoundingClientRect();
    const list = document.getElementById('obraCheckList');
    const styles = getComputedStyle(list);
    return {
      modalWidth: modal.width,
      columns: styles.gridTemplateColumns.split(' ').filter(Boolean).length,
      listHeight: list.getBoundingClientRect().height,
    };
  });

  expect(geometry.modalWidth).toBeGreaterThan(1050);
  expect(geometry.columns).toBe(2);
  expect(geometry.listHeight).toBeGreaterThan(180);
});