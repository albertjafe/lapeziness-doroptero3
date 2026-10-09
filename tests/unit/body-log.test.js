import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const B = require('../../body-log.js');
const S = require('../../professor-summary.js');

const at = (day, h, m = 0) => new Date(2026, 9, day, h, m);

describe('body-log: deporte', () => {
  it('records type and minutes and adds them per day; undone and old face-only entries do not count', () => {
    const data = { deporteEventos: [{ id: 'old', at: at(9, 9).toISOString(), kind: 'cardio', value: 70, level: 'medio' }] };
    const a = B.addSport(data, 'cardio', 30, at(10, 8));
    B.addSport(data, 'cardio', 15, at(10, 19));
    const f = B.addSport(data, 'fuerza', 45, at(10, 20));
    expect(a.id).toMatch(/^deporte_cardio_/);
    expect(B.sportByDay(data)).toEqual({ '2026-10-10': { cardio: 45, fuerza: 45 } });
    expect(B.undo(data, 'deporteEventos', f.id)).toBe(true);
    expect(B.sportByDay(data)['2026-10-10']).toEqual({ cardio: 45, fuerza: 0 });
    expect(data.deporteEventos).toHaveLength(4);
  });

  it('rejects unknown types and impossible minutes', () => {
    const data = {};
    expect(B.addSport(data, 'yoga', 30)).toBeNull();
    expect(B.addSport(data, 'cardio', 0)).toBeNull();
    expect(B.addSport(data, 'cardio', 900)).toBeNull();
  });
});

describe('body-log: sueño', () => {
  it('keeps the last answer of the day and ignores naps', () => {
    const data = { suenoEventos: [{ id: 's1', at: at(10, 15).toISOString(), kind: 'siesta' }] };
    B.setSleep(data, 'regular', at(10, 8));
    B.setSleep(data, 'bien', at(10, 8, 5));
    expect(B.sleepByDay(data)).toEqual({ '2026-10-10': 'bien' });
    expect(B.setSleep(data, 'fatal')).toBeNull();
  });

  it('asks only in the morning and only until answered; Hoy never shows numbers', () => {
    const data = {};
    expect(B.sleepPromptHtml(data, at(10, 8))).toContain('¿Qué tal has dormido?');
    expect(B.sleepPromptHtml(data, at(10, 17))).toBe('');
    B.setSleep(data, 'mal', at(10, 8));
    expect(B.sleepPromptHtml(data, at(10, 9))).toBe('');
    expect(B.sportCardHtml({}, at(10, 9)).replace(/<[^>]*>/g, '')).toBe('Deporte＋ Apuntar');
  });
});

describe('body-log: calendario e informe', () => {
  const data = {};
  B.addSport(data, 'cardio', 30, at(9, 8));
  B.setSleep(data, 'regular', at(9, 7));
  B.setSleep(data, 'bien', at(10, 7));

  it('describes a day in one line', () => {
    expect(B.dayLine(data, '2026-10-09')).toBe('Deporte: cardio 30 min · Sueño: regular');
    expect(B.dayLine(data, '2026-10-08')).toBe('');
  });

  it('gives the AI the last 14 days with «sin dato» made explicit', () => {
    const body = B.recent(data, at(10, 12), 14);
    expect(body.days).toHaveLength(14);
    expect(body.sportDays).toBe(1);
    expect(body.sleep).toEqual({ bien: 1, regular: 1, mal: 0, sinDato: 12 });
    const text = S.buildSummary({ body });
    expect(text).toContain('DEPORTE Y SUEÑO · últimos 14 días');
    expect(text).toContain('- 2026-10-09: cardio 30 min · durmió regular');
    expect(text).toContain('sin dato 12');
  });
});
