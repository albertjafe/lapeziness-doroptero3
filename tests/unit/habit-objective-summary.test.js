import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SyncCore = require('../../sync-core.js');

describe('habit objective summary', () => {
  it('treats an avoid challenge as successful on closed days without failure logs', () => {
    const summary = SyncCore.buildHabitObjectiveSummary([
      {
        id: 'habit-bed',
        title: 'No móvil en la cama',
        mode: 'avoid',
        startDate: '2026-08-23',
        durationDays: 21,
        logs: {
          '2026-08-25': { status: 'failed', at: '2026-08-25T22:00:00Z' },
        },
      },
    ], '2026-08-30');

    expect(summary.activeHabitId).toBe('habit-bed');
    expect(summary.active).toMatchObject({
      phase: 'active',
      currentDay: 8,
      closedDays: 7,
      daysRemaining: 14,
      failureCount: 1,
      successfulClosedDays: 6,
      completionDate: '2026-09-12',
      successRule: 'closed_day_without_failure_log',
      logSemantics: 'failures_only',
    });
  });

  it('identifies the newer challenge as active while an older completed one is in maintenance', () => {
    const summary = SyncCore.buildHabitObjectiveSummary([
      {
        id: 'habit-bathroom',
        title: 'No coger el móvil en el baño',
        mode: 'avoid',
        startDate: '2026-08-02',
        durationDays: 21,
        logs: {
          '2026-08-02': { status: 'failed', at: '2026-08-02T17:00:00Z' },
        },
      },
      {
        id: 'habit-bed',
        title: 'No móvil en la cama',
        mode: 'avoid',
        startDate: '2026-08-23',
        durationDays: 21,
        logs: {},
      },
    ], '2026-08-30');

    expect(summary.activeHabitId).toBe('habit-bed');
    expect(summary.items.find(item => item.id === 'habit-bathroom')).toMatchObject({
      phase: 'maintenance',
      closedDays: 21,
      failureCount: 1,
      successfulClosedDays: 20,
      challengeCompleted: true,
    });
    expect(summary.items.find(item => item.id === 'habit-bed')).toMatchObject({
      phase: 'active',
      currentDay: 8,
      closedDays: 7,
      failureCount: 0,
      successfulClosedDays: 7,
    });
  });

  it('does not infer success from missing logs for a do challenge', () => {
    const summary = SyncCore.summarizeHabitChallenge({
      id: 'habit-german',
      title: 'Alemán',
      mode: 'do',
      startDate: '2026-08-23',
      durationDays: 21,
      logs: {
        '2026-08-24': { status: 'done', at: '2026-08-24T20:00:00Z' },
      },
    }, '2026-08-30');

    expect(summary.closedDays).toBe(7);
    expect(summary.successfulClosedDays).toBe(1);
    expect(summary.successRule).toBe('closed_day_with_done_log');
    expect(summary.logSemantics).toBe('explicit_daily_status');
  });
});
