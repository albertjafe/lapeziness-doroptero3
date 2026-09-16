import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

describe('StudyPush timer snapshots', () => {
  beforeAll(() => {
    require('../../push-client.js');
  });

  it('keeps a timer deadline aligned with active elapsed time', () => {
    const now = Date.parse('2026-07-23T12:00:00Z');
    const snapshot = globalThis.StudyPush.runSnapshot({
      state: 'running',
      runId: 'run-timer',
      startTs: now - 10 * 60_000,
      pausedMs: 2 * 60_000,
      targetDurationMs: 25 * 60_000,
      displayName: 'Chopin',
    }, now);

    expect(snapshot.mode).toBe('timer');
    expect(snapshot.work_name).toBe('Chopin');
    expect(Date.parse(snapshot.ends_at) - now).toBe(17 * 60_000);
  });

  it('gives a free stopwatch a hard 120-minute server deadline', () => {
    const now = Date.parse('2026-07-23T12:00:00Z');
    const snapshot = globalThis.StudyPush.runSnapshot({
      state: 'running',
      runId: 'run-free',
      startTs: now - 32 * 60_000,
      pausedMs: 0,
      targetDurationMs: null,
      targetMinutes: null,
      displayName: 'Escalas',
    }, now);

    expect(snapshot.mode).toBe('stopwatch');
    expect(Date.parse(snapshot.ends_at) - now).toBe(88 * 60_000);
    expect(Date.parse(snapshot.started_at)).toBe(now - 32 * 60_000);
  });
  it('schedules an automatic resume after the remaining part of a five-minute pause',()=>{
    const now=Date.parse('2026-09-16T12:00:00Z');
    const snapshot=globalThis.StudyPush.runSnapshot({state:'paused',runId:'paused',
      startTs:now-20*60000,pauseStartTs:now-2*60000,pausedMs:0,targetDurationMs:25*60000},now);
    expect(snapshot.status).toBe('paused');
    expect(Date.parse(snapshot.pause_until)-now).toBe(3*60000);
    expect(Date.parse(snapshot.ends_at)-now).toBe(10*60000);
    expect(now+3*60000-Date.parse(snapshot.started_at)).toBe(18*60000);
  });
  it('does not move the deadline when a paused registration arrives after automatic resume',()=>{
    const now=Date.parse('2026-09-16T12:00:00Z');
    const snapshot=globalThis.StudyPush.runSnapshot({state:'paused',runId:'late-paused',
      startTs:now-40*60000,pauseStartTs:now-20*60000,pausedMs:0,targetDurationMs:25*60000},now);
    expect(Date.parse(snapshot.pause_until)-now).toBe(-15*60000);
    expect(Date.parse(snapshot.ends_at)-now).toBe(-10*60000);
  });
});
