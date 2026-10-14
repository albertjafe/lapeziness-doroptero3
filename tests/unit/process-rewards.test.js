import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const A = require('../../achievement-rewards.js');

// Hora local, como la ve el usuario.
const at = (day, h, m = 0) => { const [y, mo, d] = day.split('-').map(Number); return new Date(y, mo - 1, d, h, m).toISOString(); };
const block = (id, day, h, minutes, pauseMin = 0) => ({ id, date:day, seconds:minutes * 60,
  startedAt:at(day, h), endedAt:new Date(Date.parse(at(day, h)) + (minutes + pauseMin) * 60e3).toISOString() });
const ids = rows => rows.map(r => r.id).sort();
const points = (rows, id) => rows.find(r => r.id === 'bonus:process:' + id)?.effortMicroPoints / 1e6;

describe('premios por buenos hábitos de estudio', () => {
  it('a recorded pass pays 0.25 once per day, other pass types do not', () => {
    const db = { obras:[{ id:'o', paseHistory:[
      { date:at('2026-10-15', 10), tipo:'grabacion' }, { date:at('2026-10-15', 18), tipo:'grabación' },
      { date:at('2026-10-16', 10), tipo:'informal' }
    ], movimientos:[{ id:'m', paseHistory:[{ date:at('2026-10-17', 9), tipo:'recording' }] }] }] };
    const rows = A.processRows(db, [], '2026-10-20');
    expect(ids(rows)).toEqual(['bonus:process:recorded-pass:2026-10-15', 'bonus:process:recorded-pass:2026-10-17']);
    expect(points(rows, 'recorded-pass:2026-10-15')).toBe(.25);
    expect(rows[0]).toMatchObject({ progress:'process', process:'recorded-pass', source:'bonus', qualified:true });
  });

  it('early start needs the first block of the day before 11:00 and at least 25 min', () => {
    const sessions = [
      block('a', '2026-10-15', 10, 30),                                  // sí
      block('b', '2026-10-16', 10, 20),                                  // demasiado corto
      block('c', '2026-10-17', 11, 60),                                  // tarde
      block('d', '2026-10-18', 9, 40), block('e', '2026-10-18', 8, 10)   // el primero es corto
    ];
    expect(ids(A.processRows({}, sessions, '2026-10-20').filter(r => r.process === 'early-start'))).toEqual(['bonus:process:early-start:2026-10-15']);
  });

  it('deep session: 50 min or more with under 10 min of pauses, never a manual record', () => {
    const manual = { id:'m', date:'2026-10-18', seconds:3600, startedAt:at('2026-10-18', 23, 59), endedAt:at('2026-10-18', 23, 59) };
    const rows = A.processRows({}, [
      block('a', '2026-10-15', 12, 55, 5), block('b', '2026-10-15', 15, 60),   // dos el mismo día: uno
      block('c', '2026-10-16', 12, 60, 15),                                     // demasiadas pausas
      block('d', '2026-10-17', 12, 45),                                         // corto
      manual
    ], '2026-10-20');
    expect(ids(rows)).toEqual(['bonus:process:deep-session:2026-10-15']);
    expect(points(rows, 'deep-session:2026-10-15')).toBe(.15);
  });

  it('a manual record with start and end times counts for the steady week but not for early start or deep session', () => {
    const manual = { ...block('m', '2026-10-15', 9, 120), manualEntry:true };
    expect(A.processRows({}, [manual], '2026-10-20')).toEqual([]);
  });

  it('urgent task done within 48 h of becoming urgent', () => {
    const db = { cronoTasks:[
      { id:'1', priority:3, done:true, createdAt:at('2026-10-10', 9), priorityChangedAt:at('2026-10-14', 9), doneAt:at('2026-10-15', 20) },
      { id:'2', priority:3, done:true, createdAt:at('2026-10-14', 9), doneAt:at('2026-10-17', 9) },   // más de 48 h
      { id:'3', priority:2, done:true, createdAt:at('2026-10-16', 9), doneAt:at('2026-10-16', 10) },  // no urgentísima
      { id:'4', priority:3, done:false, createdAt:at('2026-10-16', 9) }
    ] };
    const rows = A.processRows(db, [], '2026-10-20');
    expect(ids(rows)).toEqual(['bonus:process:urgent-task:2026-10-15']);
    expect(points(rows, 'urgent-task:2026-10-15')).toBe(.10);
  });

  it('steady week: the fifth day with 30 min in a Monday–Sunday week, once per week', () => {
    // Semana del lunes 19-10: seis días con estudio y uno corto.
    const sessions = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25']
      .map((d, i) => block('s' + i, d, 12, 20)).concat(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-23', '2026-10-24', '2026-10-25']
      .map((d, i) => block('t' + i, d, 16, 15)));
    sessions.push(block('short', '2026-10-22', 12, 20));
    const rows = A.processRows({}, sessions, '2026-10-31').filter(r => r.process === 'steady-week');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id:'bonus:process:steady-week:2026-10-19', date:'2026-10-24' });
    expect(rows[0].effortMicroPoints).toBe(750000);
    // Cuatro días no bastan.
    expect(A.processRows({}, sessions.filter(s => !s.date.match(/2026-10-2[45]/)), '2026-10-31').filter(r => r.process === 'steady-week')).toHaveLength(0);
  });

  it('nothing before 14-10-2026 and nothing in the future', () => {
    const db = { obras:[{ id:'o', paseHistory:[{ date:at('2026-10-13', 10), tipo:'grabacion' }, { date:at('2026-10-25', 10), tipo:'grabacion' }] }] };
    expect(A.processRows(db, [block('a', '2026-10-13', 9, 60)], '2026-10-20')).toEqual([]);
  });

  it('stays small next to study: the whole daily set is worth less than 3 h of study (1 pt)', () => {
    const daily = A.PROCESS.filter(p => p.id !== 'steady-week').reduce((s, p) => s + p.points, 0);
    expect(daily).toBeCloseTo(.65);
  });
});
