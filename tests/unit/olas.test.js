import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const O = require('../../olas.js');

// Hora local (las olas se agrupan por día del dispositivo).
const at = (day, h, m = 0, s = 0) => new Date(2026, 9, day, h, m, s).toISOString();
const tap = (id, iso, extra = {}) => ({ id, at: iso, ...extra });

describe('olas: toques, olas y carga del día', () => {
  it('groups taps less than 10 s apart into one wave and caps it at 3', () => {
    const data = { olas: [
      tap('a', at(4, 10, 0, 0)), tap('b', at(4, 10, 0, 4)), tap('c', at(4, 10, 0, 8)), tap('d', at(4, 10, 0, 12)), // una ola, 4 toques → 3
      tap('e', at(4, 20, 15, 0)), // otra ola más tarde → 1
    ] };
    const waves = O.wavesByDay(data)['2026-10-04'];
    expect(waves.map(w => [w.taps, w.load])).toEqual([[4, 3], [1, 1]]);
    expect(O.loadByDay(data)).toEqual({ '2026-10-04': 4 });
  });

  it('a long or returning wave adds load with each new tap after the gap', () => {
    const data = { olas: [tap('a', at(4, 9)), tap('b', at(4, 9, 0, 30)), tap('c', at(4, 9, 5))] };
    expect(O.loadByDay(data)['2026-10-04']).toBe(3);
  });

  it('ignores undone taps, broken records and missing lists', () => {
    const data = { olas: [tap('a', at(4, 10)), tap('b', at(4, 10, 0, 3), { undone: true }), { id: 'x', at: 'nope' }, null] };
    expect(O.wavesByDay(data)['2026-10-04']).toEqual([{ start: new Date(at(4, 10)).getTime(), taps: 1, load: 1 }]);
    expect(O.loadByDay({})).toEqual({});
    expect(O.firstDay({ olas: [] })).toBeNull();
  });

  it('does not join taps across midnight into one wave', () => {
    const data = { olas: [tap('a', at(4, 23, 59, 55)), tap('b', at(5, 0, 0, 2))] };
    expect(O.loadByDay(data)).toEqual({ '2026-10-04': 1, '2026-10-05': 1 });
  });

  it('maps load to the calendar scale', () => {
    expect([0, 1, 2, 3, 4, 5, 7, 8, 20].map(O.level)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });
});

describe('olas: calendario', () => {
  const data = { olas: [tap('a', at(3, 11)), tap('b', at(3, 11, 0, 5)), tap('c', at(6, 18))] };
  const loads = O.loadByDay(data), first = O.firstDay(data), today = '2026-10-07';

  it('days before the first tap and after today have no record; tracked days without waves are calm', () => {
    expect(first).toBe('2026-10-03');
    expect(O.dayClass('2026-10-02', loads, first, today)).toBe('none');
    expect(O.dayClass('2026-10-03', loads, first, today)).toBe('o1');
    expect(O.dayClass('2026-10-04', loads, first, today)).toBe('o0');
    expect(O.dayClass('2026-10-08', loads, first, today)).toBe('none');
    expect(O.cellLabel('2026-10-04', loads, first, today)).toBe('día tranquilo');
    expect(O.cellLabel('2026-10-01', loads, first, today)).toBe('sin registro de olas');
  });

  it('summarises the month: calm days out of tracked days and mean load', () => {
    // 3–7 oct: 5 días registrados, cargas 2,0,0,1,0 → 3 tranquilos, media 0,6.
    expect(O.monthSummary(data, 2026, 9, today)).toEqual({ tracked: 5, calm: 3, total: 3, mean: 0.6 });
    expect(O.monthLine(data, 2026, 9, today)).toBe('3 de 5 días tranquilos · media 0,6/día');
    expect(O.monthLine({ olas: [] }, 2026, 9, today)).toBe('Sin olas registradas este mes');
  });

  it('compares with the previous month once both have records', () => {
    const two = { olas: [tap('s', new Date(2026, 8, 29, 10).toISOString()), ...data.olas] };
    // Septiembre: 29 y 30 registrados (cargas 1 y 0) → media 0,5. Octubre ya
    // cuenta desde el día 1 (el registro empezó antes): 7 días, carga 3 → 0,4.
    expect(O.monthLine(two, 2026, 9, today)).toBe('5 de 7 días tranquilos · media 0,4/día · mes anterior 0,5');
  });

  it('lists each wave of a day with its time and intensity', () => {
    const t = new Date(at(3, 11));
    const hh = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    expect(O.dayLine(data, '2026-10-03')).toBe('Olas: ' + hh + ' ×2');
    expect(O.dayLine(data, '2026-10-04')).toBe('');
  });
});

describe('olas: registrar y deshacer', () => {
  it('appends a record with id and reports the taps of the current wave', () => {
    const data = {};
    const now = new Date(2026, 9, 4, 12, 0, 0);
    const r1 = O.record(data, now);
    const r2 = O.record(data, new Date(now.getTime() + 3000));
    expect(data.olas).toHaveLength(2);
    expect(r1.rec.id).toMatch(/^ola-/);
    expect(r1.rec.id).not.toBe(r2.rec.id);
    expect([r1.taps, r2.taps]).toEqual([1, 2]);
  });

  it('undo marks the tap instead of removing it (sync never deletes by absence)', () => {
    const data = {};
    const { rec } = O.record(data, new Date(2026, 9, 4, 12));
    expect(O.undo(data, rec.id)).toBe(true);
    expect(data.olas).toHaveLength(1);
    expect(data.olas[0].undone).toBe(true);
    expect(O.undo(data, rec.id)).toBe(false);
    expect(O.loadByDay(data)).toEqual({});
  });

  it('the Hoy button is always the same markup (no counter to watch)', () => {
    const html = O.hoyButtonHtml();
    expect(html).toContain('Olas.tap()');
    expect(html).not.toMatch(/\d+\s*olas?/i);
  });
});
