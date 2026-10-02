import { test, expect } from '@playwright/test';

const fixture = {
  obras: [{ id: 'w1', name: 'Bach · Partita', tipo: 'obra', movimientos: [] }],
  eventos: [], sesiones: [], registro: [], forestPlants: [],
  sessionPlants: [{ id: 'p1', obraId: 'w1', mins: 30, startedAt: '2026-10-01T09:00:00Z', endedAt: '2026-10-01T09:30:00Z' }],
  germanStudy: { goals: [{ id: 'g-kindle', name: 'Kindle paperwhite', amount: 220, createdAt: '2026-09-15T10:00:00Z' }], sessions: [], materials: [], reviews: [] },
  competitionPlanningSeedVersion: 1,
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '' }));
  await page.addInitScript(data => {
    if (!localStorage.getItem('copy_check_seed')) { localStorage.setItem('alberto_piano_v2', JSON.stringify(data)); localStorage.setItem('copy_check_seed', '1'); }
  }, fixture);
  await page.goto('/');
  await page.waitForFunction(() => window.CopyCheck && window.DeviceRecovery);
  await expect(page.locator('#splashScreen')).toHaveClass(/gone/, { timeout: 15000 });
  await page.evaluate(() => { try { closeModal('modalCloudSync'); } catch (e) {} openSettings(); document.getElementById('deviceRecoveryFold').open = true; });
}

test('copia completa con memoria y «Comprobar una copia» recupera solo lo que falta', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await prepare(page);
  await page.locator('#deviceRecoveryScan').click();
  await expect(page.locator('#deviceRecoveryDownload')).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#deviceRecoveryDownload').click()]);
  expect(download.suggestedFilename()).toMatch(/^copia-completa-/);
  const saved = JSON.parse(await (await download.createReadStream()).toArray().then(chunks => Buffer.concat(chunks).toString('utf8')));
  expect(saved.formato).toBe('copia-completa-app');
  expect(saved.memory.germanStudy.goals.map(g => g.name)).toEqual(['Kindle paperwhite']);

  // La misma copia, comparada ahora: no falta nada.
  await page.locator('#copyCheckFile').setInputFiles({ name: 'copia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(saved)) });
  await expect(page.locator('#copyCheckResult')).toContainText('Todo lo que hay en la copia está en la app');

  // Una copia antigua (JSON completo de la v476) con un objetivo y un bloque que ya no están.
  const old = { schema: 'alberto-piano-ai-context-v1', rawData: JSON.parse(JSON.stringify(saved.memory)) };
  old.rawData.germanStudy.goals.push({ id: 'g-banda', name: 'Banda pecho', amount: 90, createdAt: '2026-10-01T10:00:00Z' });
  old.rawData.sessionPlants.push({ id: 'p2', obraId: 'w1', mins: 45, startedAt: '2026-10-02T09:00:00Z', endedAt: '2026-10-02T09:45:00Z' });
  await page.locator('#copyCheckFile').setInputFiles({ name: 'ia.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(old)) });
  await expect(page.locator('#copyCheckFeedback')).toContainText('2 registros de la copia no están en la app');
  await expect(page.locator('#copyCheckResult')).toContainText('Banda pecho');
  await page.locator('#copyCheckRestore').click();
  await expect(page.locator('#copyCheckFeedback')).toContainText('Recuperados 2 registros');
  const after = await page.evaluate(() => ({ goals: db.germanStudy.goals.map(g => g.name), plants: db.sessionPlants.map(p => p.id) }));
  expect(after).toEqual({ goals: ['Kindle paperwhite', 'Banda pecho'], plants: ['p1', 'p2'] });
  // Se guarda: sobrevive a recargar.
  await page.reload();
  await page.waitForFunction(() => window.CopyCheck);
  expect(await page.evaluate(() => db.germanStudy.goals.map(g => g.name))).toEqual(['Kindle paperwhite', 'Banda pecho']);
  expect(errors).toEqual([]);
});
