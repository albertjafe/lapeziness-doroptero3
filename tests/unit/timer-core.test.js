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
});
