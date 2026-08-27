import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const SyncCore = require('../../sync-core.js');

describe('SyncCore', () => {
  it('tracks a dirty local revision until the matching cloud write completes', () => {
    const dirty = SyncCore.markDirty({ localRevision: 4, dirtyRevision: 4, lastSyncedRevision: 4 });
    expect(dirty).toEqual({ localRevision: 5, dirtyRevision: 5, lastSyncedRevision: 4 });
    expect(SyncCore.isDirty(dirty)).toBe(true);
    expect(SyncCore.isDirty(SyncCore.markSynced(dirty, 5))).toBe(false);
  });

  it('takes repertoire metadata from the fresher database snapshot', () => {
    const local = {
      _localRevision: 12,
      _savedAt: '2026-08-27T12:00:00Z',
      obras: [{ id: 'beethoven', name: 'Beethoven la mayor chelo', composer: '', duracion: null, solHistory: [] }],
    };
    const cloud = {
      _localRevision: 13,
      _savedAt: '2026-08-27T12:01:00Z',
      obras: [{ id: 'beethoven', name: 'Sonata para violonchelo n.º 3, Op. 69', composer: 'Beethoven', duracion: 20, solHistory: [] }],
    };
    const result = SyncCore.mergeRepertoireIntoResult(local, cloud, {});
    expect(result.obras[0]).toMatchObject({ name: 'Sonata para violonchelo n.º 3, Op. 69', composer: 'Beethoven', duracion: 20 });
    expect(result._localRevision).toBe(13);
  });

  it('preserves histories from the older snapshot while newer metadata wins', () => {
    const older = {
      _localRevision: 2,
      obras: [{
        id: 'ligeti', name: 'Ligeti 7', solHistory: [{ date: '2026-08-20', context: 'pase', val: 78 }],
        movimientos: [{ id: 'm1', name: 'I', paseHistory: [{ id: 'p1', date: '2026-08-20', score: 8 }] }],
      }],
    };
    const fresher = {
      _localRevision: 3,
      obras: [{
        id: 'ligeti', name: 'Étude n.º 7 «Galamb borong»', composer: 'Ligeti',
        solHistory: [{ date: '2026-08-21', context: 'pase', val: 80 }],
        movimientos: [{ id: 'm1', name: 'I.', paseHistory: [{ id: 'p2', date: '2026-08-21', score: 8 }] }],
      }],
    };
    const [work] = SyncCore.mergeObrasFromFreshest(older, fresher);
    expect(work.name).toBe('Étude n.º 7 «Galamb borong»');
    expect(work.solHistory).toHaveLength(2);
    expect(work.movimientos[0].name).toBe('I.');
    expect(work.movimientos[0].paseHistory.map(item => item.id)).toEqual(['p1', 'p2']);
  });

  it('does not resurrect a work deleted from the fresher snapshot', () => {
    const older = {
      _localRevision: 7,
      obras: [{ id: 'canonical', name: 'Sonata 7' }, { id: 'duplicate', name: 'Prokofiev sonata' }],
    };
    const fresher = {
      _localRevision: 8,
      obras: [{ id: 'canonical', name: 'Sonata para piano n.º 7, Op. 83' }],
    };
    expect(SyncCore.mergeObrasFromFreshest(older, fresher).map(work => work.id)).toEqual(['canonical']);
  });

  it('uses saved time as a tie-breaker when revisions are equal', () => {
    const a = { _localRevision: 9, _savedAt: '2026-08-27T10:00:00Z', obras: [{ id: 'x', name: 'Viejo' }] };
    const b = { _localRevision: 9, _savedAt: '2026-08-27T10:05:00Z', obras: [{ id: 'x', name: 'Nuevo' }] };
    expect(SyncCore.mergeObrasFromFreshest(a, b)[0].name).toBe('Nuevo');
  });
});
