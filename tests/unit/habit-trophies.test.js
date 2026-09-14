import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const HabitTrophies = require('../../habit-trophies.js');

describe('habit trophy collection', () => {
  const habits = [
    {
      id: 'habit-bathroom', title: 'No coger el móvil en el baño', mode: 'avoid',
      startDate: '2026-08-02', durationDays: 21, createdAt: '2026-08-02T16:23:00Z',
      logs: { '2026-08-02': { status: 'failed', at: '2026-08-02T17:00:00Z' } },
    },
    {
      id: 'habit-bed', title: 'No móvil en la cama', mode: 'avoid',
      startDate: '2026-08-23', durationDays: 21, createdAt: '2026-08-23T14:35:00Z', logs: {},
    },
    { id: 'deleted', deleted: true, startDate: '2026-08-01', durationDays: 30 },
  ];

  it('projects the two existing completed habits with their scheduled finish dates', () => {
    const items = HabitTrophies.collection(habits, '2026-09-14T12:00:00');
    expect(items).toHaveLength(2);
    expect(items.map(item => item.habit.id)).toEqual(['habit-bed', 'habit-bathroom']);
    expect(items[0]).toMatchObject({ complete: true, startedOn: '2026-08-23', completedOn: '2026-09-12', success: 21, failure: 0, compliance: 100 });
    expect(items[1]).toMatchObject({ complete: true, startedOn: '2026-08-02', completedOn: '2026-08-22', success: 20, failure: 1, compliance: 95 });
  });

  it('distinguishes planned and active objectives without inventing a completion date', () => {
    const planned = HabitTrophies.itemFor({ id: 'meditate', mode: 'do', startDate: '2026-10-01', durationDays: 7, logs: {} }, '2026-09-14T12:00:00');
    const active = HabitTrophies.itemFor({ id: 'walk', mode: 'do', startDate: '2026-09-12', durationDays: 7, logs: { '2026-09-12': 'done' } }, '2026-09-14T12:00:00');
    expect(planned).toMatchObject({ status: 'planned', complete: false, completedOn: null, elapsed: 0 });
    expect(active).toMatchObject({ status: 'active', complete: false, completedOn: null, success: 1, failure: 1, progress: 43 });
  });

  it('does not interpolate a user-controlled id into trophy SVG markup', () => {
    const markup = HabitTrophies.artwork('\"><img src=x onerror=alert(1)>', true, 'test');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('onerror');
    expect(markup).toContain('habit-trophy-art');
  });
});
