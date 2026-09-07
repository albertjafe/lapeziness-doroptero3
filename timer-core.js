(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TimerCore = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const MAX_STOPWATCH_MS = 120 * 60_000;
  const TIMER_WARNING_MINUTES = [10, 5, 1];

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
      : MAX_STOPWATCH_MS;
    return Math.min(active, target);
  }

  function isTargetReached(run, now) {
    const target = Number.isFinite(run && run.targetDurationMs) && run.targetDurationMs > 0
      ? run.targetDurationMs
      : MAX_STOPWATCH_MS;
    return activeElapsedMs(run, now) >= target;
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
            .filter(value => TIMER_WARNING_MINUTES.includes(value))
        : [];
      // Compatibility with sessions saved before the 10–5–1 schedule existed.
      if (previous.fiveMinuteSent && !timerMinutesSent.includes(5)) timerMinutesSent.push(5);

      if (remainingMs > 0 && remainingMs <= TIMER_WARNING_MINUTES[0] * 60_000) {
        const currentMinute = Math.max(1, Math.ceil(remainingMs / 60_000));
        const warningMinutes = TIMER_WARNING_MINUTES.includes(currentMinute) ? currentMinute : null;
        const alreadySent = warningMinutes == null || timerMinutesSent.includes(warningMinutes);
        const nextTimerMinutesSent = Array.from(new Set(
          timerMinutesSent.concat(TIMER_WARNING_MINUTES.filter(value => remainingMs <= value * 60_000))
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
    if (elapsed >= MAX_STOPWATCH_MS) {
      return {
        fiveMinuteSent: !!previous.fiveMinuteSent,
        timerMinutesSent: Array.isArray(previous.timerMinutesSent) ? previous.timerMinutesSent.slice() : [],
        lastMilestoneMinutes: Math.min(previousMilestone, 105),
        event: null,
      };
    }
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

  return { MAX_STOPWATCH_MS, TIMER_WARNING_MINUTES, createRunId, activeElapsedMs, effectiveElapsedMs, isTargetReached, notificationCheckpoint };
});
