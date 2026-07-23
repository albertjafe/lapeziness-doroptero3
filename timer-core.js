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

  function notificationCheckpoint(run, elapsedMs, checkpoint) {
    const elapsed = Math.max(0, Number(elapsedMs) || 0);
    const previous = checkpoint || {};
    const target = Number.isFinite(run && run.targetDurationMs) && run.targetDurationMs > 0
      ? run.targetDurationMs
      : null;

    if (target != null) {
      const remainingMs = Math.max(0, target - elapsed);
      const timerMinutesSent = Array.isArray(previous.timerMinutesSent)
        ? previous.timerMinutesSent
            .map(Number)
            .filter(value => Number.isInteger(value) && value >= 1 && value <= 5)
        : [];
      // Compatibility with sessions saved before per-minute warnings existed.
      if (previous.fiveMinuteSent && !timerMinutesSent.includes(5)) timerMinutesSent.push(5);

      if (remainingMs > 0 && remainingMs <= 5 * 60_000) {
        const warningMinutes = Math.max(1, Math.min(5, Math.ceil(remainingMs / 60_000)));
        const alreadySent = timerMinutesSent.includes(warningMinutes);
        const nextTimerMinutesSent = Array.from(new Set(
          timerMinutesSent.concat([1, 2, 3, 4, 5].filter(value => value >= warningMinutes))
        )).sort((a, b) => b - a);
        if (!alreadySent) {
          return {
            fiveMinuteSent: nextTimerMinutesSent.includes(5),
            timerMinutesSent: nextTimerMinutesSent,
            lastMilestoneMinutes: Math.max(0, Number(previous.lastMilestoneMinutes) || 0),
            event: { kind: 'timer-countdown', remainingMs, warningMinutes },
          };
        }
        return {
          fiveMinuteSent: nextTimerMinutesSent.includes(5),
          timerMinutesSent: nextTimerMinutesSent,
          lastMilestoneMinutes: Math.max(0, Number(previous.lastMilestoneMinutes) || 0),
          event: null,
        };
      }
      return {
        fiveMinuteSent: timerMinutesSent.includes(5),
        timerMinutesSent,
        lastMilestoneMinutes: Math.max(0, Number(previous.lastMilestoneMinutes) || 0),
        event: null,
      };
    }

    const previousMilestone = Math.max(0, Number(previous.lastMilestoneMinutes) || 0);
    const milestoneMinutes = Math.floor(elapsed / (15 * 60_000)) * 15;
    if (!(run && run.isRest) && milestoneMinutes >= 15 && milestoneMinutes > previousMilestone) {
      return {
        fiveMinuteSent: !!previous.fiveMinuteSent,
        timerMinutesSent: Array.isArray(previous.timerMinutesSent) ? previous.timerMinutesSent.slice() : [],
        lastMilestoneMinutes: milestoneMinutes,
        event: { kind: 'stopwatch-milestone', milestoneMinutes },
      };
    }
    return {
      fiveMinuteSent: !!previous.fiveMinuteSent,
      timerMinutesSent: Array.isArray(previous.timerMinutesSent) ? previous.timerMinutesSent.slice() : [],
      lastMilestoneMinutes: previousMilestone,
      event: null,
    };
  }

  return { createRunId, activeElapsedMs, effectiveElapsedMs, isTargetReached, notificationCheckpoint };
});
