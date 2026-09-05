import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Professor = require('../../professor-core.js');
const EventGate = require('../../professor-event-gate.js');
EventGate.install(Professor);

const asOf = new Date('2026-09-03T17:00:00+02:00');

function work(id, name, sol = 55) {
  return { id, name, composer: 'Test', tipo: 'obra', dificultad: 8, movimientos: [{ id: 'm1', name: 'I', sol }] };
}

describe('Professor event gate', () => {
  it('gives zero planning priority to repertoire with no linked future event', () => {
    const report = Professor.buildReport({
      obras: [work('rach2', 'Rachmaninov Op.16 nº2')],
      sessionPlants: [{ id: 's1', obraId: 'rach2', movId: 'm1', mins: 30, startedAt: '2026-08-22T10:00:00Z' }],
      eventos: [],
    }, { asOf, googleCalendarState: {} });

    expect(report.units[0].priority.score).toBe(0);
    expect(report.units[0].priority.band).toBe('sin_evento');
    expect(report.priorities).toHaveLength(0);
    expect(report.coverage.excludedUnlinkedPlanningUnits).toBe(1);
  });

  it('ranks only repertoire explicitly linked to an event', () => {
    const report = Professor.buildReport({
      obras: [work('rach2', 'Rachmaninov Op.16 nº2'), work('wald', 'Waldstein', 45)],
      sessionPlants: [],
      eventos: [{ id: 'exam', nombre: 'Examen', tipo: 'examen', fecha: '2026-09-20', obras: ['wald'] }],
    }, { asOf, googleCalendarState: {} });

    const rach = report.units.find(unit => unit.obraId === 'rach2');
    const wald = report.units.find(unit => unit.obraId === 'wald');
    expect(rach.priority.score).toBe(0);
    expect(wald.priority.score).toBeGreaterThan(0);
    expect(report.priorities.map(item => item.key)).toEqual([wald.key]);

    const prompt = Professor.buildPrompt(report, { mode: 'remaining' });
    expect(prompt).toContain('Waldstein · I');
    expect(prompt).toContain('Rachmaninov Op.16 nº2 · I');
    expect(prompt).toMatch(/evento\/proyecto futuro enlazado.*FUERA/i);
  });

  it('delegates the chosen duration to the preference policy instead of hardcoding four hours', () => {
    expect(Professor.DEFAULT_MASTER_PROMPT).toContain('preferencia diaria');
    expect(Professor.DEFAULT_MASTER_PROMPT).not.toContain('usa 4 horas TOTALES');
  });
});
