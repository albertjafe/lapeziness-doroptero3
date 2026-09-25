import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const P = require('../../piano-rewards.js');
const A = require('../../achievement-rewards.js');

const day = (id, date, hours, extra = {}) => ({ id, date, goalId:'g', seconds:hours * 3600, activityType:'study', activityFactor:1, ...extra });
const days = (from, count, hours, prefix = 'd') => Array.from({ length:count }, (_, i) => {
  const d = new Date(from + 'T12:00:00'); d.setDate(d.getDate() + i);
  return day(prefix + i, P.dayKey(d), hours);
});

describe('racha única desde el 26-09', () => {
  it('uses the same start day in both modules', () => {
    expect(P.STREAK_RULES_DAY).toBe(A.START_DAY);
  });

  it('a partial day freezes the streak instead of breaking it (resting and studying a little are equal)', () => {
    const base = days('2026-10-01', 5, 4);
    const partial = P.streakByDay([...base, day('p', '2026-10-06', 2), day('n', '2026-10-07', 4)])['2026-10-07'];
    const rest = P.streakByDay([...base, day('n', '2026-10-07', 4)])['2026-10-07'];
    expect(partial).toMatchObject({ days:6, fullDay:true, multiplier:1.10 });
    expect(rest).toEqual(partial);
  });

  it('three consecutive days without a full day break the streak', () => {
    const base = days('2026-10-01', 5, 4);
    expect(P.streakByDay([...base, day('n', '2026-10-08', 4)])['2026-10-08'].days).toBe(6);
    expect(P.streakByDay([...base, day('n', '2026-10-09', 4)])['2026-10-09'].days).toBe(1);
    expect(P.streakStats(base, '2026-10-08')).toMatchObject({ current:5, frozen:true, graceDaysLeft:1 });
    expect(P.streakStats(base, '2026-10-09')).toMatchObject({ current:0, graceDaysLeft:0 });
  });

  it('keeps the old rules for days before the change', () => {
    const old = [day('a', '2026-09-10', 4), day('b', '2026-09-11', 2), day('c', '2026-09-12', 4)];
    expect(P.streakByDay(old)['2026-09-12'].days).toBe(1);
  });

  it('a five-hour day uses the length of the full-day streak and keeps the 1.5 cap', () => {
    const mixed = [...days('2026-10-01', 4, 4), day('five', '2026-10-05', 5)];
    const info = P.excellenceByDay(mixed)['2026-10-05'];
    expect(info).toMatchObject({ days:5, excellentDay:true });
    const rows = P.ledger(mixed.map(s => ({ ...s, policyVersion:6 })), [{ id:'g', amount:150 }]);
    expect(rows.at(-1).rewardMultiplier).toBeCloseTo(1.10 * 1.20, 6);
    const long = days('2026-10-01', 15, 5);
    expect(P.ledger(long.map(s => ({ ...s, policyVersion:6 })), [{ id:'g', amount:150 }]).at(-1).rewardMultiplier).toBe(1.5);
  });
});

describe('premios secretos desde el 26-09', () => {
  const at = (date, startHour, hours) => {
    const start = new Date(`${date}T${String(startHour).padStart(2, '0')}:00:00`);
    return day('s' + date + startHour, date, hours, { startedAt:start.toISOString(), endedAt:new Date(start.getTime() + hours * 3600000).toISOString() });
  };
  it('pays starting early more than coming back late', () => {
    const early = P.secretAchievements([at('2026-10-02', 8, 4)], '2026-10-02').find(s => s.id === 'early-bird');
    const comeback = P.secretAchievements([at('2026-10-03', 16, 4)], '2026-10-03').find(s => s.id === 'comeback');
    const epic = P.secretAchievements([at('2026-10-04', 18, 4)], '2026-10-04').find(s => s.id === 'epic-comeback');
    expect(early.points).toBe(.8);
    expect(epic.points).toBe(.6);
    expect(comeback?.points ?? .4).toBe(.4);
    expect(early.points).toBeGreaterThan(epic.points);
  });
  it('keeps the old amounts before the change', () => {
    expect(P.secretAchievements([at('2026-09-22', 8, 4)], '2026-09-22').find(s => s.id === 'early-bird').points).toBe(.4);
  });
});

describe('premios por progreso', () => {
  const db = () => ({
    obras:[{ id:'bach', name:'Bach', movimientos:[{ id:'m1', name:'Preludio', solHistory:[{ date:'2026-10-05T10:00:00Z', val:82 }, { date:'2026-10-01T10:00:00Z', val:70 }] }],
      solHistory:[{ date:'2026-10-03T10:00:00Z', val:85 }, { date:'2026-09-20T10:00:00Z', val:60 }] },
      { id:'new', name:'Ya sólida', solHistory:[{ date:'2026-10-02T10:00:00Z', val:90 }] }],
    passageTracker:{ passages:[{ id:'p1', name:'Octavas' }], observations:[
      { id:'o1', passageId:'p1', coldScore:60, recordedAt:'2026-10-01T10:00:00Z' },
      { id:'o2', passageId:'p1', coldScore:88, recordedAt:'2026-10-04T10:00:00Z' }] },
    sesiones:Array.from({ length:5 }, (_, i) => ({ date:`2026-10-0${i + 1}T20:00:00Z`, items:[{ obraId:'bach', destello:true }] })),
    eventos:[{ id:'e1', nombre:'Recital', fecha:'2026-10-10T19:00:00Z', obras:['bach'] }],
  });
  it('pays a crossing to 80 %, a mastered passage, five flashes and a prepared event once', () => {
    const rows = A.progressRows(db(), '2026-10-31');
    const byKind = k => rows.filter(r => r.progress === k);
    expect(byKind('solid').map(r => r.date)).toEqual(['2026-10-03', '2026-10-05']); // not the work that started at 90 %
    expect(byKind('passage')).toHaveLength(1);
    expect(byKind('flashes')).toHaveLength(1);
    expect(byKind('event')).toHaveLength(1);
    expect(A.progressRows(db(), '2026-10-31')).toEqual(rows);
  });
  it('does not pay progress made before the change', () => {
    const data = db();
    data.obras[0].solHistory = [{ date:'2026-09-24T10:00:00Z', val:85 }, { date:'2026-09-20T10:00:00Z', val:60 }];
    expect(A.progressRows(data, '2026-10-31').filter(r => r.id.includes('obra:bach'))).toHaveLength(0);
  });
  it('an unprepared event pays nothing', () => {
    const data = db();
    data.eventos[0].fecha = '2026-10-02T19:00:00Z'; // Bach was still at 60 % then
    expect(A.progressRows(data, '2026-10-31').filter(r => r.progress === 'event')).toHaveLength(0);
  });
});

describe('cofres y logros ocultos', () => {
  it('chests are deterministic, need 45 minutes and appear in roughly 1 of 8 long blocks', () => {
    const sessions = Array.from({ length:800 }, (_, i) => day('study-block:' + i, '2026-10-10', 1));
    const chests = A.chestRows(sessions, '2026-10-31');
    expect(chests.length).toBeGreaterThan(60);
    expect(chests.length).toBeLessThan(140);
    expect(A.chestRows(sessions, '2026-10-31')).toEqual(chests);
    chests.forEach(c => expect(A.CHEST_PRIZES).toContain(c.effortMicroPoints / 1e6));
    const short = sessions.map(s => ({ ...s, seconds:30 * 60 }));
    expect(A.chestRows(short, '2026-10-31')).toHaveLength(0);
    expect(A.chestRows(sessions.map(s => ({ ...s, date:'2026-09-20' })), '2026-10-31')).toHaveLength(0);
  });

  it('lifetime achievements use the whole history and only pay when earned after the change', () => {
    const minutes = {};
    for (let i = 0; i < 30; i++) minutes['2026-08-' + String(i + 1).padStart(2, '0')] = 190; // 95 h before the change
    minutes['2026-10-01'] = 7.5 * 60;                                                  // crosses 100 h and a 7 h day
    const list = A.achievements({}, minutes, '2026-10-31');
    expect(list.find(a => a.id === 'hours-100')).toMatchObject({ earned:true, date:'2026-10-01', paid:true });
    expect(list.find(a => a.id === 'heroic-day')).toMatchObject({ earned:true, paid:true });
    expect(list.find(a => a.id === 'no-gaps-month')).toMatchObject({ earned:false });
    expect(list.find(a => a.id === 'hours-500')).toMatchObject({ earned:false, paid:false });
    expect(A.achievementRows({}, minutes, '2026-10-31').map(r => r.id)).toEqual(['bonus:achievement:hours-100', 'bonus:achievement:heroic-day']);
  });

  it('an achievement earned before the change is shown but pays nothing', () => {
    const minutes = { '2026-08-01':6000 };
    const hundred = A.achievements({}, minutes, '2026-10-31').find(a => a.id === 'hours-100');
    expect(hundred).toMatchObject({ earned:true, paid:false });
    expect(A.achievementRows({}, minutes, '2026-10-31')).toHaveLength(0);
  });
});
