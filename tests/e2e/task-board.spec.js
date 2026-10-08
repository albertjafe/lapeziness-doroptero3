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

test('desktop panel scrolls and the large view shows everything, also for adding', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepare(page);
  const list = page.locator('#cronoIdleTasksPanel .crono-task-board-list');
  await list.hover();
  await page.mouse.wheel(0, 500);
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

  await page.locator('#cronoIdleTasksPanel .crono-task-board-expand').click();
  const modal = page.locator('#modalTaskBoard');
  await expect(modal).toHaveClass(/visible/);
  await expect(modal.locator('.crono-task-group .crono-task-row')).toHaveCount(26);
  await expect(modal.locator('#cronoBoardTaskCount')).toHaveText('26 pendientes');
  await modal.getByRole('button', { name: 'Añadir tarea de Personal' }).click();
  await modal.locator('#cronoBoardTaskInput').fill('Desde la vista grande');
  await modal.locator('.crono-task-add-btn').click();
  expect(await page.evaluate(() => cronoTasks().at(-1))).toMatchObject({ text: 'Desde la vista grande', kind: 'personal' });
  await expect(modal.locator('.crono-task-group .crono-task-row')).toHaveCount(27);
  await modal.getByRole('button', { name: 'Cerrar tareas' }).click();
  await expect(modal).not.toHaveClass(/visible/);
});

test('mobile sheet shows the most urgent tasks and opens the full screen list', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => Object.defineProperty(navigator, 'maxTouchPoints', { get: () => 5 }));
  await prepare(page);
  const isMobile = await page.evaluate(() => document.documentElement.classList.contains('mv2-on'));
  const panel = page.locator('#cronoIdleTasksPanel');
  if (isMobile) {
    await expect(panel.locator('.crono-task-group .crono-task-row')).toHaveCount(4);
    await panel.locator('.crono-task-board-more').click();
  } else {
    await panel.locator('.crono-task-board-expand').click();
  }
  const body = page.locator('#cronoBoardTasksPanel');
  await expect(body.locator('.crono-task-group .crono-task-row')).toHaveCount(26);
  await body.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(body.locator('.crono-task-group .crono-task-row').last()).toBeInViewport();
  const box = await body.locator('.crono-task-toggle').first().boundingBox();
  expect(box.width).toBeGreaterThanOrEqual(44);
});

test('break prompt lists every personal task and keeps the close button on screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 664 });
  await prepare(page);
  await page.evaluate(() => cronoOpenTaskBreakPrompt());
  const list = page.locator('#cronoTaskBreakList');
  await expect(list.locator('.crono-task-break-item')).toHaveCount(19);
  await expect(page.locator('.crono-task-break-more')).toHaveCount(0);
  await expect(page.locator('.crono-task-break-close')).toBeInViewport({ ratio: 1 });
  const heights = await list.locator('.crono-task-break-item').evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
  heights.forEach(height => expect(height).toBeGreaterThanOrEqual(46));
  await list.evaluate(el => el.scrollTo(0, el.scrollHeight));
  await expect(list.locator('.crono-task-break-item').last()).toBeInViewport();
});

for (const [label, size] of [['portrait', { width: 834, height: 1194 }], ['landscape', { width: 1194, height: 834 }]]) {
  test(`iPad ${label}: tall sheet with the whole list as its own scroll container`, async ({ browser }) => {
    const context = await browser.newContext({
      viewport: size, hasTouch: true, isMobile: true, deviceScaleFactor: 2,
      userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });
    const page = await context.newPage();
    await prepare(page);
    expect(await page.evaluate(() => document.documentElement.classList.contains('mv2-tablet'))).toBe(true);
    await page.locator('#cronoIdleDrawer .crono-idle-drawer-tab[data-tab="tareas"]').click();
    const list = page.locator('#cronoIdleTasksPanel .crono-task-board-list');
    await expect(list.locator('.crono-task-row')).toHaveCount(26);
    await expect(page.locator('#cronoIdleTasksPanel .crono-task-board.is-preview')).toHaveCount(0);
    const metrics = await list.evaluate(el => ({ client: el.clientHeight, scroll: el.scrollHeight, overflow: getComputedStyle(el).overflowY }));
    expect(metrics.overflow).toBe('auto');
    expect(metrics.scroll).toBeGreaterThan(metrics.client);
    expect(metrics.client).toBeGreaterThan(size.height * 0.4);
    await list.evaluate(el => el.scrollTo(0, el.scrollHeight));
    await expect(list.locator('.crono-task-row').last()).toBeInViewport();
    await context.close();
  });
}

test('quick add: type and press Enter, no dialog; N focuses it on desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 });
  await prepare(page);
  const input = page.locator('#cronoQuickTask-idle');
  await expect(input).toBeVisible();
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('n');
  await expect(input).toBeFocused();
  await input.fill('Llamar al afinador');
  await input.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  expect(await page.evaluate(() => cronoTasks().at(-1))).toMatchObject({ text: 'Llamar al afinador', kind: 'personal', priority: 0, done: false });
  await expect(page.locator('#cronoIdleTasksPanel .crono-task-board-list')).toContainText('Llamar al afinador');
  // Se guarda enseguida (sin bloquear el toque).
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('alberto_piano_v2')).cronoTasks.some(t => t.text === 'Llamar al afinador'))).toBe(true);
  // Desde el filtro Piano, la tarea rápida es de piano.
  await page.locator('#cronoIdleTasksPanel .crono-task-filter', { hasText: 'Piano' }).click();
  await page.locator('#cronoQuickTask-idle').fill('Digitar compás 40');
  await page.locator('#cronoQuickTask-idle').press('Enter');
  expect(await page.evaluate(() => cronoTasks().at(-1).kind)).toBe('piano');
});

test('the more urgent tasks are ignored, the harder the math to silence them', async ({ page }) => {
  await prepare(page);
  const levels = await page.evaluate(() => {
    localStorage.setItem('alberto_urgent_ignores_v1', '0');
    const l0 = cronoUrgentLevel();
    localStorage.setItem('alberto_urgent_ignores_v1', '3');
    const l3 = cronoUrgentLevel();
    localStorage.setItem('alberto_urgent_ignores_v1', '9');
    const l9 = cronoUrgentLevel();
    const q = [0, 1, 2, 3, 4, 5].map(level => cronoTaskBreakMathChallenge(level));
    // Completar una urgentísima reinicia la escalada.
    const urgent = cronoTasks().find(t => t.priority === 3 && !t.done);
    toggleCronoTask(urgent.id, null);
    return { l0, l3, l9, after: Number(localStorage.getItem('alberto_urgent_ignores_v1')), q };
  });
  expect(levels.l3).toBeGreaterThanOrEqual(3);
  expect(levels.l9).toBe(5);
  expect(levels.after).toBe(0);
  levels.q.forEach(({ question, answer }) => {
    const expr = question.replace(' = ?', '').replaceAll('×', '*').replaceAll('−', '-');
    expect(Function(`return ${expr}`)()).toBe(answer);
  });
  expect(levels.q[5].question).toMatch(/×.*\+.*×/);
});
