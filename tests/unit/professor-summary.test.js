import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const core = require('../../professor-core.js');
const summary = require('../../professor-summary.js');
const handoff = require('../../professor-handoff-resilience.js');
const trophies = require('../../habit-trophies.js');
globalThis.ProfessorSummary = summary;

const now = new Date('2026-10-05T12:00:00');
const data = () => ({
  obras: [
    { id: 'bach', name: 'Partita 2', composer: 'Bach', dificultad: 7, movimientos: [
      { id: 'sinf', name: 'Sinfonia', solHistory: [{ date: '2026-10-01T10:00:00', val: 72 }] },
      { id: 'capr', name: 'Capriccio', sol: 1 },
    ] },
    { id: 'chopin', name: 'Balada 1', composer: 'Chopin', solHistory: [{ date: '2026-07-01T10:00:00', val: 60 }] },
  ],
  eventos: [
    { id: 'rec', nombre: 'Recital', tipo: 'concierto', fecha: '2026-10-20', obras: ['bach'] },
    ...Array.from({ length: 30 }, (_, i) => ({ id: 'c' + i, nombre: 'Concurso ' + i, tipo: 'concurso', fecha: '2026-11-' + String(i % 28 + 1).padStart(2, '0'), obras: [] })),
  ],
  sessionPlants: [
    { id: 'a', obraId: 'bach', movId: 'sinf', mins: 45, startedAt: '2026-10-05T09:00:00', endedAt: '2026-10-05T09:45:00' },
    { id: 'b', obraId: 'chopin', mins: 30, startedAt: '2026-10-03T09:00:00', endedAt: '2026-10-03T09:30:00' },
  ],
  forestPlants: [], sesiones: [],
  cronoTasks: [{ id: 't', text: 'Digitar compás 40', kind: 'piano', priority: 2, done: false, obraName: 'Partita 2' },
    { id: 'd', text: 'Hecha', done: true }],
  habitChallenges: [{ id: 'h1', title: 'Sin móvil al estudiar', mode: 'avoid', startDate: '2026-09-28', durationDays: 21,
    description: 'El móvil fuera de la sala', successCriteria: 'No lo toco durante el cronómetro', motivation: 'Concentración',
    reward: 'Partitura nueva', logs: { '2026-10-02': 'failed' } }],
  estadoDiario: { date: '2026-10-05', sueno: 7 },
  germanStudy: { goals: [] },
  _savedAt: 123,
});

function report(d = data()) {
  const r = core.buildReport(d, { asOf: now, googleCalendarState: {} });
  r.habits = summary.habitsFor(d, now, trophies);
  r.otherHistory = summary.otherHistory(d);
  return r;
}

describe('resumen fiable del Profesor', () => {
  it('reads like prose: units by name, unknown solidity, only linked events create urgency', () => {
    const text = summary.buildSummary(report());
    expect(text).toContain('HOY 2026-10-05: 45 min');
    expect(text).toContain('Bach · Partita 2 · Sinfonia | solidez 72 % (medida hace 4 d)');
    expect(text).toContain('Partita 2 · Capriccio | solidez SIN MEDIR');
    expect(text).toContain('- Recital (concierto) · 2026-10-20 (en 15 d) · obras: Partita 2');
    expect(text).toContain('AGENDA SIN REPERTORIO: 30 evento(s)');
    expect(text).not.toContain('Concurso 29 ·');
    expect(text).toContain('[urgente] Digitar compás 40 · Partita 2');
    expect(text).not.toContain('Hecha');
    expect(text).toMatch(/2026-10-03: 30 min · Balada 1 30 min/);
    expect(text).toContain('DESCONOCIDO, no bajo');
    expect(text).toMatch(/última medida de hace más de 30 días: Chopin · Balada 1/);
  });

  it('includes every habit with its description, rules and daily record', () => {
    const text = summary.buildSummary(report());
    expect(text).toContain('- Sin móvil al estudiar · EVITAR · día 8/21 · cumplidos 6 · fallos 1 · racha 2 · hoy sin recaída');
    expect(text).toContain('descripción: El móvil fuera de la sala');
    expect(text).toContain('cuenta como cumplido: No lo toco durante el cronómetro');
    expect(text).toContain('recompensa elegida: Partitura nueva');
  });

  it('ships the rest of the document in the lossless appendix, without sync internals', () => {
    const r = report();
    expect(r.otherHistory.habitChallenges[0].description).toBe('El móvil fuera de la sala');
    expect(r.otherHistory.germanStudy).toEqual({ goals: [] });
    expect(r.otherHistory).not.toHaveProperty('_savedAt');
    expect(r.otherHistory).not.toHaveProperty('sesiones');
    const prompt = handoff.buildDensePrompt(r, { now: now.toISOString() }, core);
    expect(prompt.indexOf('RESUMEN_FIABLE')).toBeLessThan(prompt.indexOf('PIANO_PROF_V4'));
    expect(prompt).toContain('PLAN_PARA_HOY');
    expect(handoff.decodeContext(prompt).otherHistory).toEqual(JSON.parse(JSON.stringify(r.otherHistory)));
  });

  it('degrades to an empty but valid summary', () => {
    const text = summary.buildSummary({ asOf: now.toISOString(), units: [], events: [], today: {} });
    expect(text).toContain('REPERTORIO: no hay obras registradas.');
    expect(text).toContain('FIN_RESUMEN_FIABLE');
  });
});
