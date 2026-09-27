import { expect, test } from '@playwright/test';

// Estado actual de la app (lo que ya está en la nube) y una copia local más rica.
const current = {
  sessionPlants: [{ id: 'run_a', runId: 'a', startedAt: '2026-09-22T10:00:00.000Z', endedAt: '2026-09-22T11:00:00.000Z', mins: 60 }],
  germanStudy: { goals: [{ id: 'kindle', name: 'Kindle paperwhite', amount: 220, createdAt: '2026-09-15T10:00:00.000Z' }] },
};
const richer = {
  _savedAt: '2026-09-24T09:00:00.000Z',
  _localRevision: 7700,
  sessionPlants: [
    ...current.sessionPlants,
    { id: 'run_b', runId: 'b', startedAt: '2026-09-23T11:02:00.000Z', endedAt: '2026-09-23T13:02:00.000Z', mins: 120 },
  ],
  germanStudy: { goals: [...current.germanStudy.goals, { id: 'strap', name: 'Banda de pecho', amount: 80, createdAt: '2026-09-23T18:00:00.000Z' }] },
};

test('reviews local copies read-only, flags what the app lacks and never uploads credentials', async ({ page }) => {
  await page.goto('/device-recovery.css?v=460');
  await page.evaluate(async ({ richer }) => {
    localStorage.clear();
    localStorage.setItem('alberto_local_backup_v1', JSON.stringify(richer));
    localStorage.setItem('piano_auth_v1', '{"access_token":"SECRETO-DE-SESION"}');
    localStorage.setItem('piano_auto_creds', '{"password":"CONTRASENA"}');
    localStorage.setItem('alberto_theme', 'marmol');
    for (const name of ['piano_pre_update_rescue_v1', 'piano_snapshot_rescue_v1']) {
      await new Promise(resolve => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = resolve; });
    }
    // Copia previa a una actualización, como la guarda update-safety.js.
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('piano_pre_update_rescue_v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('snapshots', { keyPath: 'id' });
      request.onsuccess = () => {
        const tx = request.result.transaction('snapshots', 'readwrite');
        tx.objectStore('snapshots').put({ id: 'latest', capturedAt: '2026-09-24T08:00:00.000Z', raw: JSON.stringify(richer) });
        tx.oncomplete = () => { request.result.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      request.onerror = () => reject(request.error);
    });
  }, { richer });

  await page.setContent(`<!doctype html><html lang="es"><head>
    <link rel="stylesheet" href="http://127.0.0.1:4173/device-recovery.css?v=460"></head><body>
    <div class="device-recovery">
      <button id="deviceRecoveryScan">Revisar</button>
      <button id="deviceRecoveryUpload" disabled>Enviar</button>
      <button id="deviceRecoveryDownload" disabled>Descargar</button>
      <div id="deviceRecoveryFeedback"></div><div id="deviceRecoveryList"></div>
    </div></body></html>`);
  await page.evaluate(current => {
    window.db = current;
    window.__rows = [];
    window.getSB = () => ({
      auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
      from: table => ({ insert: async row => { window.__rows.push({ table, row }); return { error: null }; } }),
    });
  }, current);
  await page.addScriptTag({ url: 'http://127.0.0.1:4173/device-recovery.js?v=460' });

  await page.click('#deviceRecoveryScan');
  const list = page.locator('#deviceRecoveryList');
  await expect(list).toContainText('Copia guardada al cerrar sesión');
  await expect(list).toContainText('Copia previa a la última actualización');
  await expect(list).toContainText('Banda de pecho (80 €) ⚠︎');
  await expect(list).toContainText('1 sesiones (2 h) que la app no muestra ahora');
  await expect(page.locator('#deviceRecoveryFeedback')).toContainText('con datos que la app no muestra ahora');

  // Revisar no crea bases vacías que luego confundirían a la app.
  const names = await page.evaluate(async () => (await indexedDB.databases()).map(d => d.name));
  expect(names).not.toContain('piano_snapshot_rescue_v1');
  // Y no toca nada de lo local.
  expect(await page.evaluate(() => localStorage.getItem('alberto_local_backup_v1'))).toBe(JSON.stringify(richer));

  await page.click('#deviceRecoveryUpload');
  await expect(page.locator('#deviceRecoveryFeedback')).toContainText('Nada de este dispositivo se ha modificado');
  const rows = await page.evaluate(() => window.__rows);
  expect(rows.every(r => r.table === 'device_recovery_snapshots')).toBe(true);
  expect(rows[0].row.source).toBe('manifest');
  expect(rows[0].row.summary.skippedSensitiveKeys).toBe(2);
  expect(new Set(rows.map(r => r.row.capture_id)).size).toBe(1);

  const decoded = await page.evaluate(async rows => Promise.all(rows.filter(r => r.row.payload_gzip_b64).map(async r => {
    const bytes = Uint8Array.from(atob(r.row.payload_gzip_b64), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return { source: r.row.source, text: await new Response(stream).text() };
  })), rows);
  const everything = decoded.map(part => part.text).join('\n');
  expect(everything).toContain('Banda de pecho');
  expect(everything).not.toContain('SECRETO-DE-SESION');
  expect(everything).not.toContain('CONTRASENA');
  expect(decoded.map(part => part.source)).toContain('idb:piano_pre_update_rescue_v1/snapshots');
});
