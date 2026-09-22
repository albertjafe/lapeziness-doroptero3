(function (root, factory) {
  const api = factory(root);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.InstantSyncResilience = api;
})(typeof window !== 'undefined' ? window : globalThis, function (root) {
  'use strict';

  const RETRY_DELAYS = [1000, 3000, 10000, 30000];
  let retryIndex = 0;
  let retryTimer = null;
  let installed = false;
  let installTimer = null;
  let refreshPending = false;

  function state(message) {
    try {
      if (root && typeof root.showSyncIndicator === 'function') root.showSyncIndicator(message);
    } catch (error) {}
  }

  function createSingleFlight(run, hooks) {
    let current = null;
    let rerun = false;
    const h = hooks || {};

    const wrapped = function singleFlightSync() {
      const args = arguments;
      if (current) {
        rerun = true;
        return current;
      }

      current = (async () => {
        let value;
        do {
          rerun = false;
          if (typeof h.before === 'function') h.before();
          try {
            value = await run.apply(this, args);
            if (typeof h.success === 'function') h.success(value);
            // A coalesced request must not bypass backoff after a failed upload.
            if (value === false) break;
          } catch (error) {
            if (typeof h.error === 'function') h.error(error);
            throw error;
          }
        } while (rerun);
        return value;
      })();

      return current.finally(() => { current = null; });
    };

    wrapped.requestRerun = () => { if (current) rerun = true; };
    wrapped.isRunning = () => Boolean(current);
    return wrapped;
  }

  function scheduleRetry() {
    if (!root || retryTimer || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const delay = Math.max(RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)],root.cloudRetryDelay?.() || 0);
    retryIndex = Math.min(retryIndex + 1, RETRY_DELAYS.length - 1);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      requestImmediateSync();
    }, delay);
  }

  function resetRetry() {
    retryIndex = 0;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  }

  function requestImmediateSync(options) {
    if (!root) return;
    try {
      if (root.cloudRetryDelay?.() > 0) { refreshPending ||= !!options?.refresh; scheduleRetry(); return; }
      if (options?.now && typeof root.syncPendingCloudChanges === 'function') {
        Promise.resolve(root.syncPendingCloudChanges()).catch(() => {});
        return;
      }
      if ((options?.refresh || refreshPending) && typeof root.requestCloudRefresh === 'function') {
        refreshPending = true;
        Promise.resolve(root.requestCloudRefresh()).then(ok => {
          refreshPending = !ok;
          if (ok) resetRetry();
          else if (root._cloudSyncConnected !== false) scheduleRetry();
        }).catch(() => { state('⚠ pendiente de sincronizar'); scheduleRetry(); });
        return;
      }
      if (typeof root.enqueueCloudSync === 'function') {
        root.enqueueCloudSync({ immediate: true, source: 'instant-sync-resilience' });
        return;
      }
      if (typeof root.syncPendingCloudChanges === 'function') {
        Promise.resolve(root.syncPendingCloudChanges()).catch(() => {});
      }
    } catch (error) {
      state('⚠ pendiente de sincronizar');
      scheduleRetry();
    }
  }

  function wrapPendingSync() {
    const current = root && root.syncPendingCloudChanges;
    if (typeof current !== 'function') return false;
    if (current.__instantSyncSingleFlight) return true;

    const original = current;
    const wrapped = createSingleFlight(original, {
      before: () => state('Sincronizando…'),
      success: value => {
        if (root._cloudSyncConnected === false) {
          resetRetry();
          state('Guardado local · conecta tu cuenta');
          return;
        }
        let dirty = false;
        try { dirty = root.SyncCore.isDirty(JSON.parse(root.localStorage.getItem('alberto_sync_v1') || '{}')); } catch (_) { dirty = true; }
        if (dirty || value === false) { if (value !== false) state('⚠ pendiente de sincronizar'); scheduleRetry(); }
        else { resetRetry(); state(root._cloudSyncConnected === true ? '✓ Supabase' : 'Guardado local · conexión sin verificar'); }
      },
      error: () => {
        state('⚠ pendiente de sincronizar');
        scheduleRetry();
      },
    });
    wrapped.__instantSyncSingleFlight = true;
    wrapped.__original = original;
    root.syncPendingCloudChanges = wrapped;
    try { syncPendingCloudChanges = wrapped; } catch (error) {}
    return true;
  }

  function wrapEnqueue() {
    const current = root && root.enqueueCloudSync;
    if (typeof current !== 'function') return false;
    if (current.__instantSyncImmediate) return true;

    const original = current;
    const wrapped = function enqueueImmediateCloudSync(options) {
      const opts = Object.assign({}, options || {}, { immediate: true });
      const result = original.call(this, opts);
      return result;
    };
    wrapped.__instantSyncImmediate = true;
    wrapped.__original = original;
    root.enqueueCloudSync = wrapped;
    try { enqueueCloudSync = wrapped; } catch (error) {}
    return true;
  }

  function install() {
    if (!root) return false;
    const pending = wrapPendingSync();
    const enqueue = wrapEnqueue();
    if (!pending && !enqueue) return false;
    installed = true;
    return true;
  }

  function ensureInstalled() {
    install();
    let attempts = 0;
    clearInterval(installTimer);
    installTimer = setInterval(() => {
      attempts += 1;
      install();
      if (installed || attempts >= 80) clearInterval(installTimer);
    }, 250);
  }

  if (root && typeof root.addEventListener === 'function') {
    const refresh = () => requestImmediateSync({ refresh:true });
    root.addEventListener('online', refresh, { passive: true });
    root.addEventListener('pageshow', refresh, { passive: true });
    root.addEventListener('focus', refresh, { passive: true });
    root.addEventListener('pagehide', () => requestImmediateSync({ now:true }), { passive:true });
  }
  if (root && root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') requestImmediateSync({ refresh:true });
      else requestImmediateSync({ now:true });
    }, { passive: true });
    setInterval(() => {
      if (root.document.visibilityState === 'visible' && root._cloudSyncConnected === true)
        requestImmediateSync({ refresh:true });
    }, 30000);
    const indicator = root.document.getElementById('syncIndicator');
    if (indicator) {
      indicator.style.pointerEvents = 'auto';
      const check = () => {
        if (root._cloudSyncConnected === false) root.openModal?.('modalCloudSync');
        else requestImmediateSync({ refresh:true });
      };
      indicator.addEventListener('click', check);
      indicator.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); check(); }
      });
    }
  }

  if (root && root.document) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', ensureInstalled, { once: true });
    else ensureInstalled();
  }

  return {
    createSingleFlight,
    requestImmediateSync,
    install,
    isInstalled: () => installed,
  };
});
