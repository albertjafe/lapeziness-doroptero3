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

  it('while a wave lasts the button shows its intensity, then returns to calm', () => {
    const prev = globalThis.db;
    globalThis.db = {};
    try {
      expect(O.currentLevel()).toBe(0);
      expect([1, 2, 3, 4].map(() => O.tap().taps)).toEqual([1, 2, 3, 4]);
      expect(O.currentLevel()).toBe(3);
      expect(O.currentLevel(Date.now() + O.WAVE_GAP_MS + 1)).toBe(0);
      O.calm();
      expect(O.currentLevel()).toBe(0);
      expect(O.hoyButtonHtml(2)).toContain('data-level="2"');
      expect(O.hoyButtonHtml(3)).toContain('>Ola<');
      expect(O.hoyButtonHtml()).toContain('data-level="0"');
      expect(O.hoyButtonHtml()).toContain('>Ola<');
    } finally { O.calm(); globalThis.db = prev; }
  });
});

describe('compulsiones: registrar, semana y hoja del día', () => {
  it('records compulsions apart from waves and undo only marks them', () => {
    const data = {};
    const rec = O.recordCompulsion(data, new Date(2026, 9, 5, 10));
    expect(rec.id).toMatch(/^comp-/);
    expect(data.compulsiones).toHaveLength(1);
    expect(data.olas).toBeUndefined();
    expect(O.loadByDay(data)).toEqual({});
    expect(O.undoCompulsion(data, rec.id)).toBe(true);
    expect(data.compulsiones[0].undone).toBe(true);
    expect(O.compulsions(data)).toEqual([]);
    expect(O.undoCompulsion(data, rec.id)).toBe(false);
  });

  it('weeks start on Monday in device time', () => {
    const s = O.weekStart(new Date(2026, 9, 7, 18)); // miércoles 7-10-2026
    expect([s.getFullYear(), s.getMonth(), s.getDate(), s.getHours()]).toEqual([2026, 9, 5, 0]);
    expect(O.weekStart(new Date(2026, 9, 11, 23)).getDate()).toBe(5); // domingo
    expect(O.weekStart(new Date(2026, 9, 12, 0, 5)).getDate()).toBe(12); // lunes siguiente
  });

  it('counts waves (not taps) and compulsions this week against the previous one', () => {
    const data = {
      olas: [
        tap('p1', at(1, 9)), tap('p2', at(2, 9)), // semana anterior (jueves 1 y viernes 2)
        tap('a', at(5, 9)), tap('b', at(5, 9, 0, 4)), // misma ola, 2 toques
        tap('c', at(6, 20)), tap('d', at(7, 8), { undone: true }),
      ],
      compulsiones: [tap('k0', at(2, 9, 20)), tap('k1', at(5, 9, 15)), tap('k2', at(7, 8, 30), { undone: true })],
    };
    expect(O.weekSummary(data, O.weekStart(new Date(2026, 9, 7, 12)))).toEqual({ waves: 2, compulsions: 1 });
    expect(O.weekLine(data, new Date(2026, 9, 7, 12)))
      .toBe('Esta semana: 2 olas · 1 compulsión · semana anterior: 2 olas · 1 compulsión');
  });

  it('shows no previous week before anything was recorded and nothing without records', () => {
    expect(O.weekLine({}, new Date(2026, 9, 7, 12))).toBe('');
    const data = { olas: [tap('a', at(6, 9))], compulsiones: [] };
    expect(O.weekLine(data, new Date(2026, 9, 7, 12))).toBe('Esta semana: 1 ola · 0 compulsiones');
  });

  it('the day sheet lists compulsion times after the waves', () => {
    const data = { olas: [tap('a', at(5, 9))], compulsiones: [tap('k', at(5, 9, 15)), tap('k2', at(6, 11))] };
    const h = iso => { const t = new Date(iso); return String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0'); };
    expect(O.dayLine(data, '2026-10-05')).toBe('Olas: ' + h(at(5, 9)) + ' · Compulsiones: ' + h(at(5, 9, 15)));
    expect(O.dayLine(data, '2026-10-06')).toBe('Compulsiones: ' + h(at(6, 11)));
  });

  it('the compulsion button is always the same markup (no counter)', () => {
    const html = O.compulsionButtonHtml();
    expect(html).toContain('Olas.tapCompulsion()');
    expect(html).toContain('>Compulsión<');
    expect(html.replace(/<[^>]*>/g, '')).toBe('Compulsión');
  });
});
