import { describe, expect, it, beforeAll } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Doc = require('../../document-sync-core.js');
const Minutes = require('../../daily-study-minutes.js');
let E;
beforeAll(() => {
  globalThis.DocumentSyncCore = Doc;
  globalThis.DailyStudyMinutes = Minutes;
  E = require('../../study-edit.js');
});

const W = 'obra_w';
const dayMinutes = data => {
  const all = Minutes.minutesByDay(new Date('2026-10-12T00:00:00Z'), new Date('2026-10-15T00:00:00Z'), data);
  return Object.values(all).reduce((a, b) => a + b, 0);
};
const clone = x => JSON.parse(JSON.stringify(x));

// Forma real del 13-10-2026: un registro manual de 80 min, su copia fantasma
// (tarjeta «restored_» sin hora) y un tramo del cronómetro de 14 min.
function today() {
  return {
    sessionPlants: [
      { id: 'manual_7', mins: 80, obraId: W, movId: null, source: 'manual', startedAt: '2026-10-13T09:23:00.000Z', endedAt: '2026-10-13T10:43:00.000Z' },
      { id: 'run_73', runId: '73', mins: 14, obraId: W, movId: null, source: 'app', startedAt: '2026-10-13T10:57:58.566Z', endedAt: '2026-10-13T11:12:45.648Z' },
    ],
    forestPlants: [],
    sesiones: [{
      date: '2026-10-13T10:00:00.000Z',
      items: [
        { id: 'manual_7', manual: true, tick: 'hecho', obraId: W, movId: null, estudiado: true, studyPlantId: 'manual_7', minutosReales: 80, minutosEstudiados: 80 },
        { _planId: 'restored_uzbv', tick: 'hecho', obraId: W, movId: null, estudiado: true, startedAt: null, endedAt: null, minutosPlan: 80, minutosReales: 80 },
        { _planId: 'crono_w_1', tick: 'hecho', obraId: W, movId: null, estudiado: true, startedAt: '2026-10-13T10:57:58.566Z', endedAt: '2026-10-13T11:12:45.648Z', minutosPlan: 14, minutosReales: 14 },
      ],
      _aggregate: { crono_w_1: { subsessions: [{ min: 14, startedAt: '2026-10-13T10:57:58.566Z', endedAt: '2026-10-13T11:12:45.648Z' }] } },
    }],
  };
}

describe('copias fantasma de los registros manuales', () => {
  it('counted twice before and once after the repair, which is idempotent', () => {
    const data = today();
    expect(dayMinutes(data)).toBe(174);
    expect(E.repairManualMirrors(data, '2026-10-13T12:00:00.000Z')).toBe(1);
    expect(dayMinutes(data)).toBe(94);
    expect(data.sesiones[0].items[1]).toMatchObject({ mirrorOf: 'manual_7', estudiado: false, minutosReales: null });
    expect(E.repairManualMirrors(data)).toBe(0);
  });

  it('also finds the mirror when only the manual plant is left, and leaves real cards alone', () => {
    const data = today();
    data.sesiones[0].items.splice(0, 1); // el item manual se perdió; la planta sigue
    expect(E.repairManualMirrors(data)).toBe(1);
    const plain = { sessionPlants: [], forestPlants: [], sesiones: [{ date: '2026-10-13T10:00:00.000Z', items: [
      { _planId: 'restored_x', tick: 'hecho', obraId: W, estudiado: true, minutosReales: 30 }] }] };
    expect(E.repairManualMirrors(plain)).toBe(0);
  });
});

describe('eliminar un tramo', () => {
  it('a manual entry goes with its plant and session item, with tombstones that survive a merge with the old cloud copy', () => {
    const cloud = today();
    E.repairManualMirrors(cloud);
    const local = clone(cloud);
    const snap = E.removePlant(local, local.sessionPlants[0], '2026-10-13T12:05:00.000Z');
    expect(snap.plants).toHaveLength(1);
    expect(local.sessionPlants.map(p => p.id)).toEqual(['run_73']);
    expect(local._deletedChildren.sessionPlants['id:manual_7']).toBe('2026-10-13T12:05:00.000Z');
    expect(local.sesiones[0].items.some(it => it.id === 'manual_7')).toBe(false);
    expect(local.sesiones[0]._deletedChildren.items['id:manual_7']).toBeTruthy();
    expect(dayMinutes(local)).toBe(14);
    // La nube (copia antigua) no la devuelve.
    const merged = Doc.merge(cloud, Doc.track(local, cloud, '2026-10-13T12:05:00.000Z'));
    expect(merged.sessionPlants.map(p => p.id)).toEqual(['run_73']);
    expect(dayMinutes(merged)).toBe(14);
  });

  it('a timer run leaves its card with the minutes that remain, or marks it removed', () => {
    const data = today();
    E.repairManualMirrors(data);
    data.sessionPlants.push({ id: 'run_80', runId: '80', mins: 20, obraId: W, movId: null, source: 'app', startedAt: '2026-10-13T12:00:00.000Z', endedAt: '2026-10-13T12:20:00.000Z' });
    data.sesiones[0]._aggregate.crono_w_1.subsessions.push({ min: 20, startedAt: '2026-10-13T12:00:00.000Z', endedAt: '2026-10-13T12:20:00.000Z' });
    data.sesiones[0].items[2].minutosReales = 34;
    expect(dayMinutes(data)).toBe(114);
    E.removePlant(data, data.sessionPlants.find(p => p.id === 'run_73'), '2026-10-13T12:30:00.000Z');
    expect(data.sesiones[0].items[2]).toMatchObject({ minutosReales: 20, startedAt: '2026-10-13T12:00:00.000Z' });
    expect(dayMinutes(data)).toBe(100);
    E.removePlant(data, data.sessionPlants.find(p => p.id === 'run_80'), '2026-10-13T12:31:00.000Z');
    expect(data.sesiones[0].items[2]).toMatchObject({ estudiado: false, deletedAt: '2026-10-13T12:31:00.000Z' });
    expect(dayMinutes(data)).toBe(80);
    expect(E.isHistoryOnlyItem(data.sesiones[0].items[2])).toBe(true);
  });

  it('removes the copy of the same run kept in both lists and Forest plants without id', () => {
    const data = { sesiones: [], sessionPlants: [{ id: 'run_9', runId: '9', mins: 30, obraId: W, startedAt: '2026-10-13T08:00:00.000Z', endedAt: '2026-10-13T08:30:00.000Z' }],
      forestPlants: [{ runId: '9', mins: 30, obraId: W, startedAt: '2026-10-13T08:00:00.000Z', endedAt: '2026-10-13T08:30:00.000Z' },
        { mins: 25, tag: 'Bach', obraId: W, startedAt: '2026-10-13T15:00:00.000Z', endedAt: '2026-10-13T15:25:00.000Z' }] };
    const cloud = clone(data);
    E.removePlant(data, data.sessionPlants[0], '2026-10-13T16:00:00.000Z');
    expect(data.sessionPlants).toHaveLength(0);
    expect(data.forestPlants).toHaveLength(1);
    E.removePlant(data, data.forestPlants[0], '2026-10-13T16:01:00.000Z');
    const merged = Doc.merge(cloud, Doc.track(data, cloud, '2026-10-13T16:01:00.000Z'));
    expect(merged.sessionPlants).toHaveLength(0);
    expect(merged.forestPlants).toHaveLength(0);
  });

  it('a card without a timed block is marked removed; a manual one loses its plant too', () => {
    const data = today();
    const snap = E.removeItem(data, data.sesiones[0], data.sesiones[0].items[1], '2026-10-13T12:10:00.000Z');
    expect(snap).toBeTruthy();
    expect(data.sesiones[0].items[1]).toMatchObject({ deletedAt: '2026-10-13T12:10:00.000Z', estudiado: false });
    expect(dayMinutes(data)).toBe(94);
    E.removeItem(data, data.sesiones[0], data.sesiones[0].items[0], '2026-10-13T12:11:00.000Z');
    expect(data.sessionPlants.map(p => p.id)).toEqual(['run_73']);
    expect(dayMinutes(data)).toBe(14);
  });

  it('undo brings the study back with a new identity (tombstones are forever)', () => {
    const data = today();
    E.repairManualMirrors(data);
    const before = dayMinutes(data);
    const snap = E.removePlant(data, data.sessionPlants[0], '2026-10-13T12:20:00.000Z');
    expect(dayMinutes(data)).toBe(14);
    E.undo(data, snap, '2026-10-13T12:20:05.000Z');
    expect(dayMinutes(data)).toBe(before);
    const plant = data.sessionPlants.find(p => p.source === 'manual');
    expect(plant.id).not.toBe('manual_7');
    const item = data.sesiones[0].items.find(it => it.manual);
    expect(item.studyPlantId).toBe(plant.id);
    // Y sobrevive a las lápidas al fusionar.
    const merged = Doc.merge(data, data);
    expect(dayMinutes(merged)).toBe(before);
  });
});
