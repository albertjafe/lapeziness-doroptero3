const { test, expect } = require('@playwright/test');

const fixture = {
  obras: [{
    id: 'bach', name: 'Partita n.º 2', composer: 'J. S. Bach', tipo: 'obra', sol: 90, esc: 60,
    solHistory: [
      { val: 90, date: '2026-08-30T18:00:00Z', context: 'hecho' },
      { val: 51, date: '2026-08-29T18:00:00Z', context: 'hecho' },
      { val: 52, date: '2026-08-28T18:00:00Z', context: 'hecho' },
      { val: 51, date: '2026-08-27T18:00:00Z', context: 'hecho' },
    ],
    paseHistory: [],
    movimientos: [{
      id: 'm1', name: 'Allemande', sol: 61,
      solHistory: [
        { val: 61, date: '2026-08-30T17:00:00Z', context: 'hecho' },
        { val: 59, date: '2026-08-29T17:00:00Z', context: 'hecho' },
      ],
      paseHistory: [],
    }],
  }],
  eventos: [], sesiones: [], registro: [], sessionPlants: [], forestPlants: [], estadoEventos: [], impulsoEventos: [],
  malestarEventos: [], resistenciaEventos: [], deporteEventos: [], suenoEventos: [], triggerEventos: [],
  tiempoDisponibleEventos: [], dailyJournalEntries: [], blockedDaySchedules: [], weeklyPlans: [], memoryCards: [],
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', route => route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: '/* Supabase blocked in e2e */',
  }));
  await page.addInitScript(data => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(data));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 1, dirtyRevision: 1, lastSyncedRevision: 1 }));
  }, fixture);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof window.openPremiumWork === 'function');
}

test('shows all solidity pills vertically, flags an isolated spike and lets it be corrected', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  await page.evaluate(() => openPremiumWork('bach'));
  await page.getByRole('button', { name: 'Revisar historial' }).evaluate(button => button.click());
  await expect(page.locator('#solidityHistoryOverlay')).toHaveClass(/open/);

  const rows = page.locator('.solidity-history-row');
  await expect(rows).toHaveCount(6);
  const anomaly = page.locator('.solidity-history-row.is-anomaly');
  await expect(anomaly).toHaveCount(1);
  await expect(anomaly.locator('.solidity-history-number')).toHaveValue('90');
  await expect(anomaly).toContainText('Revisar');

  await anomaly.locator('.solidity-history-number').fill('52');
  await anomaly.locator('.solidity-history-number').press('Enter');
  await expect(page.locator('.solidity-history-row.is-anomaly')).toHaveCount(0);
  await page.getByRole('button', { name: /Guardar cambios/ }).evaluate(button => button.click());
  await expect(page.locator('.solidity-history-message')).toContainText('1 corrección guardada');

  const stored = await page.evaluate(() => {
    const work = db.obras.find(item => item.id === 'bach');
    const row = work.solHistory.find(item => item.date === '2026-08-30T18:00:00Z');
    return { value: row.val, original: row.originalSolidez, corrections: row.corrections, workSol: work.sol };
  });
  expect(stored.value).toBe(52);
  expect(stored.original).toBe(90);
  expect(stored.corrections).toHaveLength(1);
  expect(stored.corrections[0]).toMatchObject({ from: 90, to: 52 });
  expect(stored.workSol).toBe(52);
});

test('a tap anywhere on a liquid pill jumps there immediately without visual position lag', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await prepare(page);
  await page.evaluate(() => registerPase('bach'));
  const meter = page.locator('#paseQMeter');
  await expect(meter).toBeVisible();
  const reservoir = meter.locator('.pase-liquid-reservoir');
  const box = await reservoir.boundingBox();
  expect(box).toBeTruthy();

  const expected = await page.evaluate(() => pasePositionToPct(75));
  await meter.dispatchEvent('pointerdown', {
    pointerId: 42,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: box.x + box.width * 0.75,
    clientY: box.y + box.height / 2,
  });
  const immediate = await page.locator('#paseQPercent').inputValue();
  expect(Math.round(await page.evaluate(value => pasePositionToPct(Number(value)), immediate))).toBe(expected);

  const transitions = await meter.evaluate(root => ({
    fill: getComputedStyle(root.querySelector('.pase-liquid-fill')).transitionProperty,
    orb: getComputedStyle(root.querySelector('.pase-liquid-orb')).transitionProperty,
  }));
  expect(transitions.fill.split(',').map(v => v.trim())).not.toContain('width');
  expect(transitions.orb.split(',').map(v => v.trim())).not.toContain('left');
  await meter.dispatchEvent('pointerup', { pointerId: 42, pointerType: 'touch', isPrimary: true, button: 0 });
});
