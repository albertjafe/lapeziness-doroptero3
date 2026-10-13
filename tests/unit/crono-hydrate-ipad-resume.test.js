import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// iPad: al reabrir la app tras cerrarla el sistema en segundo plano,
// indexedDB.open puede no responder nunca. El cronómetro en marcha tiene que
// recuperarse igualmente y no puede quedar pisado por un estado «parado».
const rescue = readFileSync(new URL('../../crono-save-resilience.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../app.js', import.meta.url), 'utf8');

function context(timers) {
  const storage = new Map();
  const window = {
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)) },
  };
  return {
    window, db: { sessionPlants: [] }, JSON, Promise, structuredClone,
    setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout,
    indexedDB: { open() { return {}; } },   // nunca llama a onsuccess ni a onerror
    finishStudyBlock() {}, closeHechoDatos() {}, saveData() {}, recordSessionPlant() {},
    refreshStudyViews() {}, enqueueCloudSync() {}, saveLocalNow() {},
    syncPendingCloudChanges: async () => true, SyncCore: { isDirty: () => false }, _readSyncMeta: () => ({}),
  };
}

describe('cronómetro al reabrir la app en iPad', () => {
  it('el rescate queda listo aunque IndexedDB no responda', async () => {
    vi.useFakeTimers();
    try {
      const ctx = context({ setTimeout, clearTimeout });
      vm.runInNewContext(rescue, ctx);
      let ready = false;
      ctx.window.CronoSaveResilience.ready.then(() => { ready = true; });
      await vi.advanceTimersByTimeAsync(1000);
      expect(ready).toBe(false);
      await vi.advanceTimersByTimeAsync(6000);
      expect(ready).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('la recuperación no espera al rescate más que unos segundos', () => {
    const restore = app.slice(app.indexOf('async function cronoRestoreDurableState'), app.indexOf('function cronoOpenFromSystemNotification'));
    expect(restore).toContain('Promise.race');
    expect(restore).toContain('CRONO_HYDRATE_RESCUE_WAIT_MS');
    expect(restore.indexOf('Promise.race')).toBeLessThan(restore.indexOf('_cronoHydrated = true'));
  });

  it('antes de recuperar, un estado parado no pisa la sesión guardada', () => {
    const save = app.slice(app.indexOf('function cronoSaveState()'), app.indexOf('const snapshot = {', app.indexOf('function cronoSaveState()')));
    expect(save).toContain("if (!_cronoHydrated && crono.state === 'idle') return;");
  });
});
