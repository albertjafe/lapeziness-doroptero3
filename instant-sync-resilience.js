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
    const delay = RETRY_DELAYS[Math.min(retryIndex, RETRY_DELAYS.length - 1)];
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

  function requestImmediateSync() {
    if (!root) return;
    try {
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
      success: () => {
        resetRetry();
        state('✓ Supabase');
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
      queueMicrotask(() => {
        try {
          if (typeof root.syncPendingCloudChanges === 'function') {
            Promise.resolve(root.syncPendingCloudChanges()).catch(() => {});
          }
        } catch (error) {
          scheduleRetry();
        }
      });
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
      if (attempts >= 80) clearInterval(installTimer);
    }, 250);
  }

  if (root && typeof root.addEventListener === 'function') {
    root.addEventListener('online', requestImmediateSync, { passive: true });
    root.addEventListener('pageshow', requestImmediateSync, { passive: true });
  }
  if (root && root.document && typeof root.document.addEventListener === 'function') {
    root.document.addEventListener('visibilitychange', () => {
      if (root.document.visibilityState === 'visible') requestImmediateSync();
    }, { passive: true });
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
