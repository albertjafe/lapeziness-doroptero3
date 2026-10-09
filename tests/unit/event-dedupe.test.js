import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../../event-dedupe.js');

const SRC = 'dossier-2026-2027:brescia-classica-2026';
const parent = (id, extra = {}) => ({ id, nombre: 'Brescia Classica International Piano Competition', tipo: 'concurso', fecha: '2026-10-19', fechaFin: '2026-10-25', estado: 'standby', obras: [], rondas: [], repertorioPlanificado: [], planSourceId: SRC, ...extra });
const deadline = (id, extra = {}) => ({ id, nombre: 'Inscripción · Brescia Classica International Piano Competition', tipo: 'concurso', fecha: '2026-09-26', estado: 'standby', obras: [], esHito: true, hitoTipo: 'deadline', parentSourceId: SRC, ...extra });
const legacy = (id, extra = {}) => ({ id, nombre: 'Brescia Classica International Piano Competition', fecha: '2026-10-19', fechaFin: '2026-10-25', estado: 'standby', obras: [], eventRole: 'competition', planningNotes: 'Importado', repertoirePending: true, professorMovements: {}, ...extra });
const own = { id: 'ev_1', nombre: 'Concierto', fecha: '2026-10-20', obras: ['o1'] };

describe('event-dedupe: copias de concursos importados', () => {
  it('keeps one copy per competition and per deadline, and leaves the rest of the calendar alone', () => {
    const data = { eventos: [own, parent('competition_m3_b'), parent('competition_m1_a'), parent('competition_m2_c'), deadline('deadline_m2_x'), deadline('deadline_m1_y'), legacy('standby_comp_01')] };
    expect(D.apply(data)).toBe(4);
    expect(data.eventos.map(e => e.id).sort()).toEqual(['competition_m1_a', 'deadline_m1_y', 'ev_1']);
    expect(data.planningEventTombstones.sort()).toEqual(['competition_m2_c', 'competition_m3_b', 'deadline_m2_x', 'standby_comp_01'].sort());
    expect(D.plan(data).remove).toEqual([]);
  });

  it('every device picks the same copy, so two partial views never delete all copies', () => {
    const a = { eventos: [parent('competition_m1_a'), parent('competition_m2_b')] };
    const b = { eventos: [parent('competition_m2_b'), parent('competition_m3_c')] };
    const gone = new Set([...D.plan(a).remove, ...D.plan(b).remove]);
    expect(gone.has('competition_m1_a')).toBe(false);
    expect([...gone].sort()).toEqual(['competition_m2_b', 'competition_m3_c']);
  });

  it('never removes a copy with your data; only untouched copies go', () => {
    const data = { eventos: [parent('competition_m1_a'), parent('competition_m2_b', { obras: ['o7'] }), parent('competition_m3_c', { notas: 'llevar partitura' })] };
    expect(D.plan(data).remove).toEqual(['competition_m1_a']);
    const saved = { eventos: [parent('competition_m1_a'), parent('competition_m2_b', { manualSaved: true }), parent('competition_m3_c', { estado: 'confirmado' })] };
    expect(D.plan(saved).remove).toEqual(['competition_m1_a']);
  });

  it('matches old standby copies by date and title, also with a shared acronym or the same final day', () => {
    expect(D.sameCall(
      { nombre: 'International Piano Competition Spanish Composers (CIPCE)', fecha: '2026-11-08', fechaFin: '2026-11-14' },
      { nombre: 'CIPCE – Compositores de España (Federico Mompou)', fecha: '2026-11-08', fechaFin: '2026-11-14' })).toBe(true);
    expect(D.sameCall(
      { nombre: 'Leeds International Piano Competition', fecha: '2027-09-08', fechaFin: '2027-09-18' },
      { nombre: 'Leeds International Piano Competition', fecha: '2027-03-30', fechaFin: '2027-09-18' })).toBe(true);
    expect(D.sameCall(
      { nombre: 'Leeds International Piano Competition', fecha: '2027-09-08' },
      { nombre: 'Sydney International Piano Competition', fecha: '2027-09-08' })).toBe(false);
    // Una standby_* sola, sin copia del dosier, no se toca.
    expect(D.plan({ eventos: [legacy('standby_comp_02', { nombre: 'Otro concurso', fecha: '2027-01-01' })] }).remove).toEqual([]);
  });

  it('does nothing without duplicates or without data', () => {
    expect(D.apply({ eventos: [own, parent('competition_m1_a')] })).toBe(0);
    expect(D.apply({})).toBe(0);
  });
});
