import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Catalog = require('../../work-structure-catalog.js');

describe('WorkStructureCatalog', () => {
  it('matches Waldstein from normalized repertoire metadata', () => {
    const match = Catalog.matchWorkStructure({ composer: 'Beethoven', name: 'Sonata para piano n.º 21 en do mayor, Op. 53 «Waldstein»' });
    expect(match).not.toBeNull();
    expect(match.movements).toHaveLength(3);
    expect(match.movements[2].name).toContain('Rondo');
  });

  it('matches the Bartók Sonata and keeps its three movements explicit', () => {
    const match = Catalog.matchWorkStructure({ composer: 'Bartók', name: 'Sonata para piano (1926), Sz. 80, BB 88' });
    expect(match).not.toBeNull();
    expect(match.movements.map(m => m.name)).toEqual([
      'I. Allegro moderato',
      'II. Sostenuto e pesante',
      'III. Allegro molto',
    ]);
  });

  it('fills generic movement names and missing durations without touching history', () => {
    const work = {
      id: 'waldstein', composer: 'Beethoven', name: 'Waldstein Op. 53',
      movimientos: [
        { id: 'm1', name: 'Movimiento 1', duracion: null, sol: 64, paseHistory: [{ id: 'p1' }] },
        { id: 'm2', name: 'Mi nombre manual', duracion: 4.5, sol: 20 },
        { id: 'm3', name: 'Movimiento 3', duracion: null, sol: 50 },
      ],
    };
    const result = Catalog.completeWorkStructure(work);
    expect(result.changed).toBe(true);
    expect(result.work.movimientos[0]).toMatchObject({ id: 'm1', name: 'I. Allegro con brio', duracion: 11, sol: 64 });
    expect(result.work.movimientos[0].paseHistory).toEqual([{ id: 'p1' }]);
    expect(result.work.movimientos[1]).toMatchObject({ name: 'Mi nombre manual', duracion: 4.5 });
    expect(result.work.movimientos[2].name).toContain('Rondo');
    expect(work.movimientos[0].name).toBe('Movimiento 1');
  });

  it('does not force a structure onto an unrelated work', () => {
    const match = Catalog.matchWorkStructure({ composer: 'Albéniz', name: 'Triana' });
    expect(match).toBeNull();
  });

  it('creates movements only when a known work has none', () => {
    const result = Catalog.completeWorkStructure({ composer: 'Tchaikovsky', name: 'Concierto para piano n.º 1 Op. 23', movimientos: [] });
    expect(result.changed).toBe(true);
    expect(result.work.movimientos).toHaveLength(3);
    expect(result.work.movimientos.every(m => m.duracionEstimada === true)).toBe(true);
    expect(result.work.movimientos[0].paseHistory).toEqual([]);
  });
});
