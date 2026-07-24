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

  it('describes a free session as a stopwatch without an end date', () => {
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
    expect(snapshot.ends_at).toBeNull();
    expect(Date.parse(snapshot.started_at)).toBe(now - 32 * 60_000);
  });
});
