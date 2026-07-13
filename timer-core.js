(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimerCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createRunId(random) {
    if (typeof random === 'function') return 'run_' + random().toString(36).slice(2) + '_' + Date.now().toString(36);
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return 'run_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function activeElapsedMs(run, now) {
    if (!run || !run.startTs) return 0;
    const current = Number.isFinite(now) ? now : Date.now();
    const end = run.state === 'paused' && run.pauseStartTs ? run.pauseStartTs : current;
    return Math.max(0, end - run.startTs - (run.pausedMs || 0));
  }

  function effectiveElapsedMs(run, now) {
    const active = activeElapsedMs(run, now);
    const target = Number.isFinite(run && run.targetDurationMs) && run.targetDurationMs > 0
      ? run.targetDurationMs
      : null;
    return target == null ? active : Math.min(active, target);
  }

  function isTargetReached(run, now) {
    const target = Number.isFinite(run && run.targetDurationMs) && run.targetDurationMs > 0
      ? run.targetDurationMs
      : null;
    return target != null && activeElapsedMs(run, now) >= target;
  }

  return { createRunId, activeElapsedMs, effectiveElapsedMs, isTargetReached };
});
