import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DataCore = require('../../data-core.js');

describe('DataCore work structure reconciliation', () => {
  it('restores a studied movement from cloud into a locally newer work snapshot', () => {
    const obraId = 'brahms-99';
    const movId = 'm1';
    const local = {
      obras: [{ id: obraId, name: 'Brahms Op. 99', minutosExtra: 1, movimientos: [] }],
      sessionPlants: [{ id: 'p1', obraId, movId, startedAt: '2026-09-01T17:00:00Z', endedAt: '2026-09-01T17:09:00Z', mins: 9 }],
      forestPlants: [],
      sesiones: [],
    };
    const cloud = {
      obras: [{
        id: obraId,
        name: 'Brahms Op. 99',
        minutosExtra: 7636,
        movimientos: [{
          id: movId,
          name: 'I. Allegro vivace',
          sol: 47,
          lastPase: '2026-09-01T16:56:34.364Z',
          solHistory: [{ date: '2026-09-01T16:56:34.364Z', val: 47 }],
          paseHistory: [{ id: 'pass-1', date: '2026-09-01T16:56:34.364Z', score: 5, solidezPct: 47 }],
        }],
      }],
      sessionPlants: [],
      forestPlants: [],
      sesiones: [],
    };

    const merged = DataCore.mergeStudyHistory(local, cloud);
    const brahms = merged.obras.find(work => work.id === obraId);
    expect(brahms.movimientos).toHaveLength(1);
    expect(brahms.movimientos[0]).toMatchObject({ id: movId, name: 'I. Allegro vivace', sol: 47 });
    expect(brahms.movimientos[0].paseHistory).toHaveLength(1);
  });

  it('keeps the freshest scalar movement state while merging histories', () => {
    const older = {
      id: 'm1', sol: 50, lastPase: '2026-08-30T10:00:00Z',
      solHistory: [{ date: '2026-08-30T10:00:00Z', val: 50 }],
      paseHistory: [], zoneHistory: [], compasHistory: [],
    };
    const newer = {
      id: 'm1', sol: 80, lastPase: '2026-09-01T10:00:00Z',
      solHistory: [{ date: '2026-09-01T10:00:00Z', val: 80 }],
      paseHistory: [{ id: 'p2', date: '2026-09-01T10:00:00Z', score: 8 }],
      zoneHistory: [], compasHistory: [],
    };

    const merged = DataCore.mergeMovement(older, newer);
    expect(merged.sol).toBe(80);
    expect(merged.solHistory.map(entry => entry.val)).toEqual([50, 80]);
    expect(merged.paseHistory.map(entry => entry.id)).toEqual(['p2']);
  });

  it('does not resurrect an unstudied movement removed from the base snapshot', () => {
    const merged = DataCore.mergeMovements(
      [],
      [{ id: 'unused', name: 'Movimiento borrado', solHistory: [], paseHistory: [], zoneHistory: [], compasHistory: [] }],
      new Set()
    );
    expect(merged).toEqual([]);
  });

  it('preserves an other-only work only when study records still reference it', () => {
    const work = { id: 'studied-work', name: 'Obra estudiada', movimientos: [] };
    const kept = DataCore.mergeWorks([], [work], [{ id: 'plant', obraId: 'studied-work', startedAt: '2026-09-01T10:00:00Z' }]);
    const dropped = DataCore.mergeWorks([], [work], []);
    expect(kept.map(item => item.id)).toEqual(['studied-work']);
    expect(dropped).toEqual([]);
  });
});
