import { test, expect } from '@playwright/test';

// Windows de escritorio: la capa final desktop-app.css/.js.
const fixture = {
  competitionPlanningSeedVersion: 999,
  obras: [
    { id: 'b', name: 'Partita nº 2', composer: 'J. S. Bach', dificultad: 7, movimientos: [{ id: 'm1', name: 'Sinfonia', solHistory: [] }] },
    { id: 'c', name: 'Balada nº 1', composer: 'F. Chopin', movimientos: [], solHistory: [] },
  ],
  eventos: [], sesiones: [], sessionPlants: [], forestPlants: [], registro: [],
  germanStudy: { version: 1, materials: [], reviews: [], sessions: [], ledger: [], goals: [{ id: 'g', name: 'Partituras', amount: 120, createdAt: '2026-09-01T10:00:00Z' }] },
};

async function boot(page, width = 1366, height = 768) {
  await page.setViewportSize({ width, height });
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'text/javascript', body: '/* sin nube */' }));
  await page.addInitScript(data => {
    Object.defineProperty(navigator, 'platform', { configurable: true, get: () => 'Win32' });
    Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36' });
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, get: () => 0 });
    if (!localStorage.getItem('alberto_piano_v2')) localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
  }, fixture);
  await page.goto('/');
  await page.waitForFunction(() => window.DesktopShortcuts && typeof showView === 'function');
  await expect(page.locator('html')).toHaveClass(/platform-windows/);
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} });
}

// El elemento se ve entero: dentro de la ventana y sin ancestro que lo recorte.
async function fullyVisible(locator) {
  return locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom > innerHeight || r.right > innerWidth) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(hidden|clip|auto|scroll)/.test(cs.overflowY + cs.overflowX)) {
        const pr = p.getBoundingClientRect();
        if (r.bottom > pr.bottom + 1 || r.top < pr.top - 1) return false;
      }
    }
    return true;
  });
}

for (const [w, h] of [[1366, 768], [1920, 1080]]) {
  test(`${w}×${h}: el botón Iniciar del cronómetro se ve entero sin hacer scroll`, async ({ page }) => {
    await boot(page, w, h);
    await page.evaluate(() => showView('cronometro'));
    const start = page.locator('#cronoStartBtn');
    await expect(start).toBeVisible();
    expect(await fullyVisible(start)).toBe(true);
    // La mesa de trabajo no se sale por la derecha.
    const drawer = await page.locator('#cronoIdleDrawer').boundingBox();
    expect(drawer.x + drawer.width).toBeLessThanOrEqual(w);
  });
}

test('las pantallas principales no desbordan en horizontal y la cabecera es de una línea', async ({ page }) => {
  await boot(page);
  for (const view of ['session', 'cronometro', 'obras', 'calendario', 'profesor', 'deutsch']) {
    await page.evaluate(v => showView(v), view);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, view).toBeLessThanOrEqual(1);
    const header = await page.locator('.header').boundingBox();
    expect(header.height, view).toBeLessThanOrEqual(64);
  }
  await page.evaluate(() => showView('obras'));
  const detail = await page.locator('#obrasRdDetail').boundingBox();
  expect(detail.x + detail.width).toBeLessThanOrEqual(1366);
});

test('los modales quedan por encima de la barra lateral y Esc los cierra con su propio Cancelar', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => openAddEvento());
  const modal = page.locator('#modalEvento .modal, .modal-overlay.visible .modal').first();
  await expect(modal).toBeVisible();
  const box = await modal.boundingBox();
  const rail = await page.locator('.nav.nav-bottom').boundingBox();
  // El punto central del modal y una esquina de la barra lateral: el overlay manda.
  const topAtRail = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('.modal-overlay') !== null, { x: rail.x + 20, y: rail.y + 200 });
  expect(topAtRail).toBe(true);
  // Centrado en la ventana y nunca más ancho que ella (el de eventos es ancho a propósito).
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(1366);
  await page.keyboard.press('Escape');
  await expect(page.locator('.modal-overlay.visible')).toHaveCount(0);
});

test('Esc nunca cierra el aviso de tarea urgente', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => {
    db.cronoTasks = [{ id: 'u', text: 'Enviar programa', kind: 'personal', priority: 3, done: false, createdAt: new Date(Date.now() - 5 * 86400000).toISOString() }];
    saveData(); showView('cronometro');
  });
  await page.waitForTimeout(400);
  const gate = page.locator('#modalCronoUrgentTaskGate');
  if (await gate.count() && await gate.evaluate(el => el.classList.contains('visible'))) {
    await page.keyboard.press('Escape');
    await expect(gate).toHaveClass(/visible/);
  }
});

test('Alt+número cambia de pantalla y Espacio inicia y pausa el cronómetro', async ({ page }) => {
  await boot(page);
  await page.keyboard.press('Alt+3');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'obras');
  await page.keyboard.press('Alt+2');
  await expect(page.locator('body')).toHaveAttribute('data-view', 'cronometro');
  await page.evaluate(() => { const sel = document.querySelector('#view-cronometro select'); sel.value = [...sel.options].find(o => o.value).value; sel.dispatchEvent(new Event('change', { bubbles: true })); document.activeElement?.blur(); });
  await expect(page.locator('#cronoStartBtn')).toBeEnabled();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => crono.state)).toBe('running');
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => crono.state)).toBe('paused');
  await expect(page.locator('#cronoStartBtn')).toHaveAttribute('title', /Espacio/);
});
