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

  it('keeps the challenge calendar running while failures reduce the prize in play', () => {
    const base={
      id:'habit-current',title:'No redes antes de estudiar',mode:'avoid',
      startDate:'2026-09-20',durationDays:21,createdAt:'2026-09-20T06:00:00Z',
      successCriteria:'No abrir redes antes de la primera sesión',
      logs:{'2026-09-24':{status:'failed'}},
    };
    base.effortReward=HabitTrophies.createRewardPolicy(base,new Date('2026-09-20T07:00:00Z'));
    const status=HabitTrophies.rewardStatus(base,new Date('2026-09-25T12:00:00Z'));
    expect(status).toMatchObject({status:'active',points:0,potentialPoints:1.5,maxPoints:3,graded:true});
    expect(status.item).toMatchObject({failure:1,elapsed:6});
  });

  it('pays 3, 1.5, 0.75 or 0 points after a graduated habit cycle', () => {
    const makeHabit=failures=>{
      const habit={
        id:'h-'+failures,title:'Evitar',mode:'avoid',startDate:'2026-09-20',durationDays:21,
        createdAt:'2026-09-20T06:00:00Z',successCriteria:'Evitar la conducta',logs:{}
      };
      for(let i=0;i<failures;i++)habit.logs[HabitTrophies.keyAt(habit.startDate,i)]={status:'failed'};
      habit.effortReward=HabitTrophies.createRewardPolicy(habit,new Date('2026-09-20T07:00:00Z'));
      return habit;
    };
    expect(HabitTrophies.rewardStatus(makeHabit(0),new Date('2026-10-11T12:00:00Z'))).toMatchObject({status:'earned',points:3});
    expect(HabitTrophies.rewardStatus(makeHabit(1),new Date('2026-10-11T12:00:00Z'))).toMatchObject({status:'earned',points:1.5});
    expect(HabitTrophies.rewardStatus(makeHabit(2),new Date('2026-10-11T12:00:00Z'))).toMatchObject({status:'earned',points:.75});
    expect(HabitTrophies.rewardStatus(makeHabit(3),new Date('2026-10-11T12:00:00Z'))).toMatchObject({status:'failed',points:0,potentialPoints:0});
  });

  it('preserves the old all-or-nothing rule for cycles completed before the transition', () => {
    const habit={
      id:'legacy',title:'Legacy',mode:'avoid',startDate:'2026-08-01',durationDays:21,
      createdAt:'2026-08-01T06:00:00Z',successCriteria:'Evitar',logs:{'2026-08-03':{status:'failed'}}
    };
    habit.effortReward={
      ...HabitTrophies.LEGACY_REWARD_POLICY,agreedAt:'2026-08-01T07:00:00Z',
      startDate:habit.startDate,durationDays:habit.durationDays,mode:habit.mode,successCriteria:habit.successCriteria
    };
    expect(HabitTrophies.rewardStatus(habit,new Date('2026-08-22T12:00:00Z'))).toMatchObject({status:'failed',points:0,potentialPoints:0,graded:false});
  });

});
