import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{
    id: 'bach', name: 'Bach · Suite', composer: 'J. S. Bach', tipo: 'obra', sol: 50,
    compasesTotal: 200, compasActual: 200,
    movimientos: [
      { id: 'm1', name: 'I. Preludio', sol: 70, compasesTotal: 100, compasActual: 100, solHistory: [{ val: 70, date: '2026-08-20' }] },
      { id: 'm2', name: 'II. Danza', sol: 35, compasesTotal: 100, compasActual: 100, solHistory: [{ val: 35, date: '2026-08-20' }] },
    ],
    solHistory: [{ val: 50, date: '2026-08-20' }],
  }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], estadoEventos: [], impulsoEventos: [],
  deporteEventos: [], suenoEventos: [], triggerEventos: [], tiempoDisponibleEventos: [], dailyJournalEntries: [],
};

test('iPad landscape idle timer shows movement + work readiness without overlapping controls', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 834 });
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline test */' }));
  await page.addInitScript(data => localStorage.setItem('alberto_piano_v2', JSON.stringify(data)), fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    showView('cronometro');
    const select = document.getElementById('cronoObraSelect');
    select.value = 'mov::bach::m1';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    cronoRenderReadinessEstimate();
  });

  const main = page.locator('#cronoIdleReadinessMain');
  await expect(main).toContainText('Movimiento');
  await expect(main).toContainText('Obra completa');

  const geometry = await page.evaluate(() => {
    const box = selector => {
      const el = document.querySelector(selector);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
    };
    const overlap = (a, b) => a.x < b.right && a.right > b.x && a.y < b.bottom && a.bottom > b.y;
    const mode = box('#cronoModeToggle');
    const start = box('#cronoStartBtn');
    const ring = box('#cronoIdleDisplayWrap');
    const message = box('#cronoIdleMessage');
    const readiness = box('#cronoIdleReadiness');
    return {
      mode, start, ring, message, readiness,
      modeStartOverlap: overlap(mode, start),
      ringMessageOverlap: overlap(ring, message),
      readinessRingOverlap: overlap(readiness, ring),
      columns: getComputedStyle(document.querySelector('#cronoModeToggle')).gridTemplateColumns.split(' ').filter(Boolean).length,
    };
  });

  expect(geometry.modeStartOverlap).toBe(false);
  expect(geometry.ringMessageOverlap).toBe(false);
  expect(geometry.readinessRingOverlap).toBe(false);
  expect(geometry.columns).toBe(2);
  expect(geometry.ring.width).toBeGreaterThanOrEqual(280);
  expect(geometry.start.width).toBeGreaterThanOrEqual(130);
  expect(geometry.mode.height).toBeGreaterThanOrEqual(44);
});
