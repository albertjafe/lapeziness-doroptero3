import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Doc = require('../../document-sync-core.js');
const HabitTrophies = require('../../habit-trophies.js');

// Regression: a habit with an effort reward stored the frozen failurePoints
// array, so every later local save threw and the habit vanished on reload.
describe('saves never break on frozen data', () => {
  it('stores a mutable failure schedule in new reward policies', () => {
    const habit = { mode: 'avoid', startDate: '2026-09-20', durationDays: 21, successCriteria: 'Móvil fuera' };
    const policy = HabitTrophies.createRewardPolicy(habit, new Date('2026-09-20T07:00:00Z'));
    expect(policy.failurePoints).toEqual([3, 1.5, 0.75, 0]);
    expect(Object.isFrozen(policy.failurePoints)).toBe(false);
  });

  it('replaces a frozen array instead of throwing while reconciling', () => {
    const target = { habit: { failurePoints: Object.freeze([3, 1.5, 0.75, 0]) } };
    const result = Doc.assign(target, { habit: { failurePoints: [3, 1.5, 0.75, 0] } });
    expect(result.habit.failurePoints).toEqual([3, 1.5, 0.75, 0]);
    expect(Object.isFrozen(result.habit.failurePoints)).toBe(false);
  });
});
