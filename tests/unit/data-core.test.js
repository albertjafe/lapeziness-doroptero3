import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DataCore = require('../../data-core.js');

describe('DataCore', () => {
  it('merges study plants without duplicating a stable id', () => {
    const merged = DataCore.mergeStudyHistory(
      { sessionPlants: [{ id: 'a', startedAt: '2026-07-13T10:00:00Z', mins: 20 }], sesiones: [] },
      { sessionPlants: [{ id: 'a', startedAt: '2026-07-13T10:00:00Z', mins: 20 }, { id: 'b', startedAt: '2026-07-13T11:00:00Z', mins: 10 }], sesiones: [] }
    );
    expect(merged.sessionPlants.map(p => p.id)).toEqual(['a', 'b']);
  });

  it('keeps the daily session with more real minutes', () => {
    const date = '2026-07-13T12:00:00Z';
    const merged = DataCore.mergeStudyHistory(
      { sesiones: [{ date, items: [{ estudiado: true, minutosReales: 10 }] }] },
      { sesiones: [{ date, items: [{ estudiado: true, minutosReales: 30 }] }] }
    );
    expect(DataCore.sessionRealMinutes(merged.sesiones[0])).toBe(30);
  });

  it('keeps the latest availability event for each civil day', () => {
    const merged = DataCore.mergeStudyHistory(
      { tiempoDisponibleEventos: [{ date: '2026-07-13', at: '2026-07-13T08:00:00Z', value: 30 }] },
      { tiempoDisponibleEventos: [{ date: '2026-07-13', at: '2026-07-13T09:00:00Z', value: 60 }] }
    );
    expect(merged.tiempoDisponibleEventos).toEqual([{ date: '2026-07-13', at: '2026-07-13T09:00:00Z', value: 60 }]);
  });

  it('merges resisted-urge events without losing either device', () => {
    const merged = DataCore.mergeStudyHistory(
      { impulsoEventos: [{ id: 'urge-a', at: '2026-07-13T08:00:00Z', value: 40, label: 'Bajo' }] },
      { impulsoEventos: [{ id: 'urge-b', at: '2026-07-13T09:00:00Z', value: 80, label: 'Alto' }] }
    );
    expect(merged.impulsoEventos.map(event => event.id)).toEqual(['urge-a', 'urge-b']);
  });
});
