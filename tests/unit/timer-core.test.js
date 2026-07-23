import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const TimerCore = require('../../timer-core.js');

describe('TimerCore', () => {
  it('caps a target timer even when the browser wakes up late', () => {
    const run = { state: 'running', startTs: 1_000, pausedMs: 0, targetDurationMs: 25 * 60_000 };
    expect(TimerCore.effectiveElapsedMs(run, 1_000 + 2 * 60 * 60_000)).toBe(25 * 60_000);
    expect(TimerCore.isTargetReached(run, 1_000 + 2 * 60 * 60_000)).toBe(true);
  });

  it('does not count a paused interval', () => {
    const run = { state: 'paused', startTs: 1_000, pauseStartTs: 10 * 60_000 + 1_000, pausedMs: 0 };
    expect(TimerCore.activeElapsedMs(run, 90 * 60_000)).toBe(10 * 60_000);
    run.state = 'running';
    run.pausedMs = 5 * 60_000;
    expect(TimerCore.activeElapsedMs(run, 19 * 60_000 + 1_000)).toBe(14 * 60_000);
  });

  it('leaves a free stopwatch uncapped', () => {
    const run = { state: 'running', startTs: 1_000, pausedMs: 0, targetDurationMs: null };
    expect(TimerCore.effectiveElapsedMs(run, 1_000 + 8 * 60 * 60_000)).toBe(8 * 60 * 60_000);
  });

  it('requests one warning at each of the final five timer minutes', () => {
    const run = { targetDurationMs: 25 * 60_000, isRest: false };
    let checkpoint = TimerCore.notificationCheckpoint(run, 19 * 60_000, {});
    expect(checkpoint.event).toBeNull();

    checkpoint = TimerCore.notificationCheckpoint(run, 20 * 60_000 + 1, checkpoint);
    expect(checkpoint.event).toEqual({
      kind: 'timer-countdown',
      remainingMs: 5 * 60_000 - 1,
      warningMinutes: 5,
    });
    expect(TimerCore.notificationCheckpoint(run, 20 * 60_000 + 1, checkpoint).event).toBeNull();

    for (const warningMinutes of [4, 3, 2, 1]) {
      checkpoint = TimerCore.notificationCheckpoint(
        run,
        (25 - warningMinutes) * 60_000 + 1,
        checkpoint
      );
      expect(checkpoint.event).toEqual({
        kind: 'timer-countdown',
        remainingMs: warningMinutes * 60_000 - 1,
        warningMinutes,
      });
    }
    expect(checkpoint.timerMinutesSent).toEqual([5, 4, 3, 2, 1]);
  });

  it('reports only the current timer minute after a late background wake', () => {
    const run = { targetDurationMs: 25 * 60_000, isRest: false };
    const before = TimerCore.notificationCheckpoint(run, 19 * 60_000, {});
    expect(before.event).toBeNull();

    const warning = TimerCore.notificationCheckpoint(run, 22 * 60_000 + 1, before);
    expect(warning.event).toEqual({
      kind: 'timer-countdown',
      remainingMs: 3 * 60_000 - 1,
      warningMinutes: 3,
    });
    expect(warning.timerMinutesSent).toEqual([5, 4, 3]);
  });

  it('reports only the latest crossed 15-minute stopwatch milestone', () => {
    const run = { targetDurationMs: null, isRest: false };
    const first = TimerCore.notificationCheckpoint(run, 15 * 60_000, {});
    expect(first.event).toEqual({ kind: 'stopwatch-milestone', milestoneMinutes: 15 });

    const lateWake = TimerCore.notificationCheckpoint(run, 46 * 60_000, first);
    expect(lateWake.event).toEqual({ kind: 'stopwatch-milestone', milestoneMinutes: 45 });
    expect(TimerCore.notificationCheckpoint(run, 46 * 60_000, lateWake).event).toBeNull();
  });

  it('does not create stopwatch milestones during a rest', () => {
    const result = TimerCore.notificationCheckpoint(
      { targetDurationMs: null, isRest: true },
      60 * 60_000,
      {}
    );
    expect(result.event).toBeNull();
  });
});
