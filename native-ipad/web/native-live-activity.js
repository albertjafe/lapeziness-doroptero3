(function installStudyLiveActivityBridge() {
  'use strict';

  let installed = false;
  let applyingNativeAction = false;
  let registeredPlugin = null;

  function plugin() {
    if (registeredPlugin) return registeredPlugin;
    if (window.Capacitor && typeof window.Capacitor.registerPlugin === 'function') {
      registeredPlugin = window.Capacitor.registerPlugin('StudyLiveActivity');
      return registeredPlugin;
    }
    return window.Capacitor && window.Capacitor.Plugins
      ? window.Capacitor.Plugins.StudyLiveActivity
      : null;
  }

  async function callNative(method, payload) {
    const target = plugin();
    if (!target || typeof target[method] !== 'function') return null;
    try {
      return await target[method](payload || {});
    } catch (error) {
      console.warn('[StudyLiveActivity]', method, error);
      return null;
    }
  }

  function snapshot() {
    if (!window.crono || (crono.state !== 'running' && crono.state !== 'paused') || !crono.runId) {
      return null;
    }
    const now = Date.now();
    const elapsedMs = typeof cronoEffectiveElapsedMs === 'function'
      ? cronoEffectiveElapsedMs()
      : Math.max(0, now - crono.startTs - (crono.pausedMs || 0));
    const targetMs = crono.targetDurationMs || null;
    const remainingMs = targetMs == null ? null : Math.max(0, targetMs - elapsedMs);

    return {
      sessionId: crono.runId,
      workName: crono.displayName || 'Sesion de estudio',
      mode: targetMs == null ? 'stopwatch' : 'timer',
      startedAt: now - elapsedMs,
      endsAt: remainingMs == null ? null : now + remainingMs,
      isPaused: crono.state === 'paused',
      elapsedMs: Math.round(elapsedMs),
    };
  }

  function syncActivity(method) {
    const state = snapshot();
    if (!state) return Promise.resolve(null);
    return callNative(method, state);
  }

  function wrap(name, after) {
    const original = window[name];
    if (typeof original !== 'function' || original.__liveActivityWrapped) return;
    const wrapped = function wrappedLiveActivityFunction(...args) {
      const beforeRunId = window.crono && crono.runId;
      const result = original.apply(this, args);
      after({ args, beforeRunId, result });
      return result;
    };
    wrapped.__liveActivityWrapped = true;
    wrapped.__liveActivityOriginal = original;
    window[name] = wrapped;
  }

  async function applyPendingNativeActions() {
    const pending = await callNative('consumePendingAction');
    if (!pending || !window.crono || !crono.runId) return;

    applyingNativeAction = true;
    try {
      const extendMinutes = Math.max(0, Number(pending.extendMinutes) || 0);
      if (extendMinutes && typeof window.cronoExtendTimer === 'function') {
        window.cronoExtendTimer(extendMinutes);
      }

      const endedAt = Number(pending.endedAt) || 0;
      if (endedAt && crono.state !== 'idle' && typeof window.cronoFinish === 'function') {
        if (crono.state === 'running') {
          if (typeof window.cronoStopTick === 'function') window.cronoStopTick();
          crono.state = 'paused';
          crono.pauseStartTs = Math.min(Date.now(), endedAt);
          if (typeof window.cronoSaveState === 'function') window.cronoSaveState();
        }
        window.cronoFinish(crono.runId);
      }
    } finally {
      applyingNativeAction = false;
    }
  }

  function installHooks() {
    if (installed || typeof window.cronoStart !== 'function') return;
    installed = true;

    // The native variant uses one Live Activity instead of web notifications.
    window.cronoRequestNotificationPermissionFromGesture = function nativeNotificationNoop() {};
    window.cronoCheckSessionNotifications = function nativeNotificationCheckNoop() { return null; };

    wrap('cronoStart', () => setTimeout(() => syncActivity('start'), 0));
    wrap('cronoStartRest', () => setTimeout(() => syncActivity('start'), 0));
    wrap('cronoPause', () => setTimeout(() => syncActivity('update'), 0));
    wrap('cronoResume', () => setTimeout(() => syncActivity('update'), 0));
    wrap('cronoExtendTimer', ({ args }) => {
      if (applyingNativeAction) return;
      const minutes = Math.max(1, Math.round(Number(args[0]) || 5));
      callNative('extend', { minutes });
    });
    wrap('cronoFinish', ({ beforeRunId }) => {
      if (beforeRunId && (!crono.runId || crono.runId !== beforeRunId)) callNative('end');
    });
    wrap('cronoReset', ({ beforeRunId }) => {
      if (beforeRunId) callNative('end');
    });

    if (snapshot()) syncActivity('start');
    applyPendingNativeActions();
  }

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) applyPendingNativeActions();
  });
  window.addEventListener('focus', applyPendingNativeActions);
  window.addEventListener('load', () => setTimeout(installHooks, 0));
  setTimeout(installHooks, 500);
})();
