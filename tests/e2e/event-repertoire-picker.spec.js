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
    movimientos: [],
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
  await page.evaluate(() => {
    renderObraCheckList(['work_2', 'work_37']);
    const modal = document.getElementById('modalAddEvento');
    modal.classList.add('active');
    modal.style.display = 'flex';
    EventRepertoirePicker.enhance({ reset: true });
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
