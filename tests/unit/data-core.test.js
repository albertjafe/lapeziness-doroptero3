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

  it('keeps the latest blocked schedule for each civil day', () => {
    const merged = DataCore.mergeStudyHistory(
      { blockedDaySchedules: [{ date: '2026-07-13', updatedAt: '2026-07-13T08:00:00Z', blocks: [{ start: '09:00', end: '10:00' }] }] },
      { blockedDaySchedules: [{ date: '2026-07-13', updatedAt: '2026-07-13T09:00:00Z', blocks: [{ start: '11:00', end: '12:30' }] }] }
    );
    expect(merged.blockedDaySchedules).toEqual([
      { date: '2026-07-13', updatedAt: '2026-07-13T09:00:00Z', blocks: [{ start: '11:00', end: '12:30' }] }
    ]);
  });

  it('merges discomfort events and their context without losing either device', () => {
    const merged = DataCore.mergeStudyHistory(
      { malestarEventos: [{ id: 'distress-a', at: '2026-07-13T08:00:00Z', value: 40, label: 'Bajo', note: 'Tensión física' }] },
      { malestarEventos: [{ id: 'distress-b', at: '2026-07-13T09:00:00Z', value: 80, label: 'Alto', note: 'Pensamiento repetitivo' }] }
    );
    expect(merged.malestarEventos.map(event => event.id)).toEqual(['distress-a', 'distress-b']);
    expect(merged.malestarEventos[1].note).toBe('Pensamiento repetitivo');
  });

  it('merges resistance events without losing either device', () => {
    const merged = DataCore.mergeStudyHistory(
      { resistenciaEventos: [{ id: 'resistance-a', at: '2026-07-13T08:00:00Z', value: 40, label: 'Baja' }] },
      { resistenciaEventos: [{ id: 'resistance-b', at: '2026-07-13T09:00:00Z', value: 80, label: 'Alta', note: 'Quería cambiar de tarea' }] }
    );
    expect(merged.resistenciaEventos.map(event => event.id)).toEqual(['resistance-a', 'resistance-b']);
    expect(merged.resistenciaEventos[1].note).toBe('Quería cambiar de tarea');
  });

  it('keeps a deleted pulse record deleted when another device still has it', () => {
    const merged = DataCore.mergeStudyHistory(
      { estadoEventos: [{ id: 'pulse-37', at: '2026-07-13T10:00:00Z', value: 37, label: '37%' }] },
      { estadoEventos: [], pulseDeletedIds: ['concentration::pulse-37'] }
    );
    expect(merged.estadoEventos).toEqual([]);
    expect(merged.pulseDeletedIds).toContain('concentration::pulse-37');
  });

  it('merges daily challenge logs from two devices without losing either day', () => {
    const shared = {
      id: 'habit-1', title: 'Practicar escalas', mode: 'do', durationDays: 14,
      startDate: '2026-08-01', createdAt: '2026-08-01T08:00:00Z',
    };
    const merged = DataCore.mergeStudyHistory(
      { habitChallenge: { ...shared, updatedAt: '2026-08-01T20:00:00Z', logs: { '2026-08-01': { status: 'done', at: '2026-08-01T20:00:00Z' } } } },
      { habitChallenge: { ...shared, updatedAt: '2026-08-02T20:00:00Z', logs: { '2026-08-02': { status: 'done', at: '2026-08-02T20:00:00Z' } } } }
    );
    expect(Object.keys(merged.habitChallenge.logs)).toEqual(['2026-08-01', '2026-08-02']);
  });

  it('keeps a newer daily challenge deletion instead of resurrecting it', () => {
    const merged = DataCore.mergeStudyHistory(
      { habitChallenge: { id: 'habit-1', title: 'Antiguo', updatedAt: '2026-08-02T10:00:00Z' } },
      { habitChallenge: { id: 'habit-1', deleted: true, updatedAt: '2026-08-02T11:00:00Z' } }
    );
    expect(merged.habitChallenge.deleted).toBe(true);
  });

  it('keeps a newer cleared day from being re-marked by an older device', () => {
    const shared = { id: 'habit-1', title: 'Escalas', mode: 'do', startDate: '2026-08-02', durationDays: 7 };
    const merged = DataCore.mergeStudyHistory(
      { habitChallenge: { ...shared, updatedAt: '2026-08-02T10:00:00Z', logs: { '2026-08-02': { status: 'done', at: '2026-08-02T10:00:00Z' } } } },
      { habitChallenge: { ...shared, updatedAt: '2026-08-02T10:01:00Z', logs: { '2026-08-02': { status: 'clear', at: '2026-08-02T10:01:00Z' } } } }
    );
    expect(merged.habitChallenge.logs['2026-08-02'].status).toBe('clear');
  });
});
