import { test, expect } from '@playwright/test';

// Tablero de tareas v495: todas las pendientes, sin tope, agrupadas por urgencia y filtrables.
const tasks = Array.from({ length: 26 }, (_, i) => ({
  id: 't' + i, text: 'Tarea número ' + i, kind: i % 4 === 0 ? 'piano' : 'personal',
  priority: i % 4, done: false, createdAt: new Date(Date.now() - i * 60000).toISOString(),
}));
const data = { obras: [{ id: 'o1', name: 'Obra', composer: 'X', tipo: 'obra', movimientos: [], sol: 50, solHistory: [] }], eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], cronoTasks: tasks };

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(d => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(d));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
  await page.evaluate(() => { showView('cronometro'); cronoSetIdleDrawerTab('tareas'); renderCronoTasks(); });
}

test('shows every pending task grouped by urgency and filters by kind', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await prepare(page);
  const board = page.locator('#cronoIdleTasksPanel .crono-task-board');
  await expect(board.locator('.crono-task-group .crono-task-row')).toHaveCount(26);
  await expect(board.locator('.crono-task-group > h4')).toHaveText([/Urgentísima\s*6/i, /Urgente\s*6/i, /Importante\s*7/i, /Normal\s*7/i]);
  await expect(page.locator('#cronoIdleDrawerTaskTabCount')).toHaveText('26');
  await expect(board.locator('.crono-task-kind-tag')).toHaveCount(7);

  await board.locator('.crono-task-filter', { hasText: 'Piano' }).click();
  await expect(board.locator('.crono-task-group .crono-task-row')).toHaveCount(7);
  await expect(board.locator('.crono-task-kind-tag')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('alberto_crono_task_filter_v1'))).toBe('piano');

  // Añadir desde el filtro Piano crea una tarea de piano; el selector permite cambiarla.
  await board.getByRole('button', { name: 'Añadir tarea de Piano' }).click();
  const panel = page.locator('#cronoIdleTasksPanel');
  await expect(panel.locator('.crono-task-kind-btn[data-kind="piano"]')).toHaveClass(/active/);
  await panel.locator('.crono-task-kind-btn[data-kind="personal"]').click();
  await panel.locator('#cronoIdleTaskInput').fill('Nueva personal');
  await panel.locator('.crono-task-add-btn').click();
  expect(await page.evaluate(() => cronoTasks().at(-1))).toMatchObject({ text: 'Nueva personal', kind: 'personal' });

  await board.locator('.crono-task-filter', { hasText: 'Todas' }).click();
  await expect(page.locator('#cronoIdleTasksPanel .crono-task-group .crono-task-row')).toHaveCount(27);
});

test('mobile sheet lists every task and scrolls inside the panel', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepare(page);
  const panel = page.locator('#cronoIdleTasksPanel');
  await expect(panel.locator('.crono-task-group .crono-task-row')).toHaveCount(26);
  const last = panel.locator('.crono-task-group .crono-task-row').last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport();
  const box = await panel.locator('.crono-task-toggle').first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
});
