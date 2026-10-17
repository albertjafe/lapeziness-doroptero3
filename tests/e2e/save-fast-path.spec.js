import { test, expect } from '@playwright/test';

// Guardado por secciones (v506): debe dar exactamente el mismo documento que el
// camino completo (seguir cambios + fusionar con el disco), y ser mucho más rápido.
const iso = i => new Date(Date.UTC(2026, 0, 1) + i * 3600e3).toISOString();
const data = {
  obras: Array.from({ length: 20 }, (_, i) => ({ id: 'o' + i, name: 'Obra ' + i, tipo: 'obra', movimientos: [{ id: 'm' + i, name: 'I', solHistory: [] }], solHistory: [{ date: iso(i), val: 50 }] })),
  sesiones: Array.from({ length: 800 }, (_, i) => ({ id: 's' + i, date: iso(i), min: 30, items: [{ obraId: 'o1', min: 30 }] })),
  forestPlants: Array.from({ length: 3000 }, (_, i) => ({ id: 'f' + i, mins: 30, obraId: 'o1', startedAt: iso(i), extra: 'z'.repeat(80) })),
  sessionPlants: [], registro: [], eventos: [{ id: 'e1', nombre: 'Concurso', fecha: '2026-11-01', obras: ['o1'] }],
  cronoTasks: Array.from({ length: 10 }, (_, i) => ({ id: 't' + i, text: 'Tarea ' + i, kind: 'personal', priority: 0, done: false, createdAt: iso(i) })),
  habitChallenge: { id: 'h1', title: 'Reto', startDate: '2026-10-01', logs: {}, updatedAt: iso(1) },
  someSetting: 'a',
};

async function prepare(page) {
  await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: '/* offline */' }));
  await page.addInitScript(d => {
    localStorage.setItem('alberto_piano_v2', JSON.stringify(d));
    localStorage.setItem('alberto_sync_v1', JSON.stringify({ localRevision: 0, dirtyRevision: 0, lastSyncedRevision: 0 }));
  }, data);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
}

test('section-level save gives exactly the same document as the full merge', async ({ page }) => {
  await prepare(page);
  const results = await page.evaluate(() => {
    saveData();                                   // establece lo que hay en disco
    const mutations = {
      task: () => { const t = db.cronoTasks[3]; t.priority = 2; t.updatedAt = new Date().toISOString(); },
      newSession: () => { db.sesiones.push({ id: 'snew', date: new Date().toISOString(), min: 45, items: [] }); },
      deleteTask: () => { db.cronoTasks.splice(1, 1); },
      deleteSection: () => { delete db.someSetting; },
      addSection: () => { db.brandNew = { id: 'x', value: 1 }; },
      nested: () => { db.habitChallenge.logs['2026-10-02'] = { status: 'failed' }; db.obras[0].movimientos[0].name = 'I. Allegro'; },
    };
    const out = {};
    for (const [name, mutate] of Object.entries(mutations)) {
      mutate();
      const snap = { db: JSON.stringify(db), last: JSON.stringify(_lastSavedDocument), cache: _saveCache };
      const realNow = Date.now; const fixed = realNow() + 1000; Date.now = () => fixed;
      const t0 = performance.now(); _prepareLocalDocument(true); const fastMs = performance.now() - t0;
      const fast = JSON.stringify(db);
      // Mismo punto de partida por el camino completo.
      DocumentSyncCore.assign(db, JSON.parse(snap.db));
      _lastSavedDocument = JSON.parse(snap.last);
      _saveCache = null;
      const t1 = performance.now(); _prepareLocalDocument(true); const fullMs = performance.now() - t1;
      const full = JSON.stringify(db);
      Date.now = realNow;
      out[name] = { same: fast === full, fastMs: Math.round(fastMs), fullMs: Math.round(fullMs) };
      if (fast !== full) out[name].diff = [fast.slice(0, 200), full.slice(0, 200)];
      saveData();                                 // guarda y deja la caché lista para el siguiente
      _saveCache = _saveCache || null;
    }
    return { out, cacheReady: !!_saveCache };
  });
  console.log('TIEMPOS', JSON.stringify(results.out));
  for (const [name, r] of Object.entries(results.out)) expect(r.same, name + ' ' + JSON.stringify(r)).toBe(true);
  expect(results.cacheReady).toBe(true);
});

test('if another tab wrote the document, the full path is used', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(() => {
    saveData();
    const before = !!_saveCache;
    const other = JSON.parse(localStorage.getItem('alberto_piano_v2'));
    other.cronoTasks.push({ id: 'other-tab', text: 'Desde otra pestaña', kind: 'personal', done: false, createdAt: new Date().toISOString() });
    localStorage.setItem('alberto_piano_v2', JSON.stringify(other));
    db.cronoTasks[0].priority = 3; db.cronoTasks[0].updatedAt = new Date().toISOString();
    saveData();
    const saved = JSON.parse(localStorage.getItem('alberto_piano_v2'));
    return { before, keepsOther: saved.cronoTasks.some(t => t.id === 'other-tab'), keepsMine: saved.cronoTasks[0].priority === 3 };
  });
  expect(r.before).toBe(true);
  expect(r.keepsOther).toBe(true);
  expect(r.keepsMine).toBe(true);
});

test('a task-only save does not repaint study views and the text is built once', async ({ page }) => {
  await prepare(page);
  const r = await page.evaluate(async () => {
    saveData();
    await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
    let refreshes = 0, stringifiedDocs = 0;
    const origRefresh = refreshConcentradoUI;
    refreshConcentradoUI = function (...a) { refreshes++; return origRefresh.apply(this, a); };
    const origStringify = JSON.stringify;
    JSON.stringify = function (v, ...rest) { if (v === db) stringifiedDocs++; return origStringify.call(this, v, ...rest); };
    try {
      db.cronoTasks[2].priority = 3; db.cronoTasks[2].updatedAt = new Date().toISOString();
      saveData();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
      const tasksOnly = refreshes;
      db.sesiones.push({ id: 'snew2', date: new Date().toISOString(), min: 30, items: [] });
      saveData();
      await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
      return { tasksOnly, afterStudy: refreshes, stringifiedDocs, cache: !!_saveCache, saved: JSON.parse(localStorage.getItem('alberto_piano_v2')).cronoTasks[2].priority };
    } finally { JSON.stringify = origStringify; refreshConcentradoUI = origRefresh; }
  });
  expect(r.tasksOnly).toBe(0);
  expect(r.afterStudy).toBe(1);
  expect(r.stringifiedDocs).toBe(0);   // se arma por secciones, nunca el documento entero
  expect(r.cache).toBe(true);
  expect(r.saved).toBe(3);
});
