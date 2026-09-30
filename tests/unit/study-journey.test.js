import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const J = require('../../study-journey.js');

// Hora local del 29-09-2026 (la jornada se lee en la hora del dispositivo).
const at = (h, m = 0, day = 29) => new Date(2026, 8, day, h, m).toISOString();
const block = (h1, m1, h2, m2, extra = {}) => {
  const mins = ((h2 * 60 + m2) - (h1 * 60 + m1));
  return { date: '2026-09-' + (extra.day || 29), startedAt: at(h1, m1, extra.day), endedAt: at(h2, m2, extra.day), mins: mins * (extra.factor ?? 1), rawMins: mins };
};

describe('jornada de un día', () => {
  // 10:00–11:30 · pausa 15 · 11:45–13:00 · comida 2 h · 15:00–16:30 · 20 · 16:50–17:30
  const day = [block(10, 0, 11, 30), block(11, 45, 13, 0), block(15, 0, 16, 30), block(16, 50, 17, 30)];

  it('separates short breaks from long gaps and measures the rhythm without the long ones', () => {
    const j = J.journey(day, {});
    expect(j.total).toBe(90 + 75 + 90 + 40);
    expect(j.span).toBe(450);
    expect(j.shortBreak).toBe(35);
    expect(j.longGap).toBe(120);
    expect(j.gaps).toHaveLength(1);
    expect(j.gaps[0]).toMatchObject({ key: '2026-09-29T13:00', min: 120, tag: null });
    // 295 min de estudio en 330 min entre tramos (sin el hueco de la comida).
    expect(Math.round(j.rhythm * 100)).toBe(89);
    // Sobre toda la ventana serían 295/450 = 66 %: la cifra engañosa de antes.
    expect(Math.round(j.total / j.span * 100)).toBe(66);
  });

  it('finds when the 4 h are reached, with the same weighted minutes as the ring', () => {
    const j = J.journey(day, {});
    // 90 + 75 + 75 de 90 → 240 a las 16:15, 6 h 15 después de empezar.
    expect(new Date(j.reachAt).getHours()).toBe(16);
    expect(new Date(j.reachAt).getMinutes()).toBe(15);
    expect(j.toReach).toBe(375);
    // Una clase de cámara cuenta la mitad para las 4 h, pero entera para el ritmo.
    const chamber = J.journey([block(10, 0, 12, 0, { factor: 0.5 }), block(12, 10, 14, 0)], {});
    expect(chamber.total).toBe(60 + 110);
    expect(chamber.reachAt).toBeNull();
    expect(Math.round(chamber.rhythm * 100)).toBe(Math.round(230 / 240 * 100));
  });

  it('reads the tag of each long gap by the minute it starts', () => {
    const j = J.journey(day, { '2026-09-29T13:00': { tag: 'comida', at: 'x' } });
    expect(j.gaps[0].tag).toBe('comida');
  });

  it('counts overlapping blocks once when measuring gaps', () => {
    const j = J.journey([block(10, 0, 12, 0), block(11, 0, 11, 30), block(13, 0, 14, 0)], {});
    expect(j.gaps).toHaveLength(1);
    expect(j.gaps[0].min).toBe(60);
  });

  it('keeps untimed session items in the total but out of the timeline', () => {
    const j = J.journey([{ date: '2026-09-29', mins: 30 }, block(10, 0, 11, 0)], {});
    expect(j).toMatchObject({ total: 90, untimed: 30, timed: 1, span: 60 });
  });
});

describe('resumen y comparación', () => {
  it('summarises start, time to 4 h, rhythm and gaps per day, and splits gaps by tag', () => {
    const tags = { '2026-09-28T13:00': { tag: 'comida' }, '2026-09-29T13:30': { tag: 'perdido' } };
    const days = {
      '2026-09-28': J.journey([block(9, 0, 13, 0, { day: 28 }), block(14, 0, 15, 0, { day: 28 })], tags),
      '2026-09-29': J.journey([block(11, 0, 13, 30), block(15, 30, 16, 0)], tags),
    };
    const s = J.summary(days, '2026-09-28', '2026-09-29');
    expect(s.days).toBe(2);
    expect(s.start).toBe(600); // mediana de 9:00 y 11:00
    expect(s.reached).toBe(1);
    expect(s.toReach).toBe(240);
    expect(s.longGapPerDay).toBe(90);
    expect(s.byTag).toEqual({ comida: 60, perdido: 120 });
    expect(s.lostPerDay).toBe(60);
    expect(s.untagged).toBe(0);
  });

  it('compares with the latest habit that has run at least three days', () => {
    const d = { habitChallenges: [
      { id: 'a', title: 'Viejo', startDate: '2026-06-01' },
      { id: 'b', title: 'Desintoxicación', startDate: '2026-09-20' },
      { id: 'c', title: 'Reabierto', startDate: '2026-09-25', reopenOf: 'x' },
      { id: 'd', title: 'Recién empezado', startDate: '2026-09-29' },
    ] };
    expect(J.habitToCompare(d, '2026-09-30').id).toBe('b');
    expect(J.habitToCompare({ habitChallenges: [{ id: 'a', startDate: '2026-06-01' }] }, '2026-09-30')).toBeNull();
  });
});
