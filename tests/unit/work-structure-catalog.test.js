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

  it('matches Ravel Sonatine and creates its three canonical movements', () => {
    const match = Catalog.matchWorkStructure({ composer: 'Maurice Ravel', name: 'Sonatine, M.40' });
    expect(match).not.toBeNull();
    expect(match.movements.map(m => m.name)).toEqual([
      'I. Modéré',
      'II. Mouvement de menuet',
      'III. Animé',
    ]);
    const result = Catalog.completeWorkStructure({ composer: 'Ravel', name: 'Sonatina Ravel M. 40', movimientos: [] });
    expect(result.changed).toBe(true);
    expect(result.work.movimientos).toHaveLength(3);
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

  it('uses stable movement ids when two devices create the same catalog structure', () => {
    const work = { id: 'prokofiev-7', composer: 'Prokofiev', name: 'Sonata para piano n.º 7, Op. 83', movimientos: [] };
    const first = Catalog.completeWorkStructure(work).work.movimientos.map(movement => movement.id);
    const second = Catalog.completeWorkStructure(structuredClone(work)).work.movimientos.map(movement => movement.id);
    expect(second).toEqual(first);
    expect(first.every(id => id.startsWith('mvcat_'))).toBe(true);
  });

  it('compacts exact catalog copies, merges their history and remaps references', () => {
    const names = ['I. Allegro inquieto', 'II. Andante caloroso', 'III. Precipitato'];
    const movements = [0, 1, 2, 3].flatMap(copy => names.map((name, index) => ({
      id: `copy-${copy}-${index}`,
      name,
      sol: copy === 2 && index === 0 ? 82 : 1,
      solHistory: copy === 2 && index === 0 ? [{ id: 'rating', date: '2026-09-10', val: 82 }] : [],
      paseHistory: copy === 3 && index === 2 ? [{ id: 'pass', date: '2026-09-11', solidezPct: 76 }] : [],
    })));
    const result = Catalog.completeWorkStructure({
      id: 'prokofiev-7', composer: 'Prokofiev', name: 'Sonata para piano n.º 7, Op. 83', movimientos: movements,
    });
    expect(result.changed).toBe(true);
    expect(result.work.movimientos).toHaveLength(3);
    expect(result.work.movimientos[0]).toMatchObject({ id: 'copy-0-0', sol: 82 });
    expect(result.work.movimientos[0].solHistory).toEqual([{ id: 'rating', date: '2026-09-10', val: 82 }]);
    expect(result.work.movimientos[2].paseHistory).toEqual([{ id: 'pass', date: '2026-09-11', solidezPct: 76 }]);
    const db = { sessionPlants: [{ movId: 'copy-2-0' }], evento: { movimientosObjetivo: ['copy-3-2'] } };
    expect(Catalog.remapMovementReferences(db, result.idMap)).toBe(true);
    expect(db).toEqual({ sessionPlants: [{ movId: 'copy-0-0' }], evento: { movimientosObjetivo: ['copy-0-2'] } });
  });

  it('leaves a personalised non-repeating structure untouched', () => {
    const movements = [
      { id: 'a', name: 'I. Exposición' },
      { id: 'b', name: 'II. Desarrollo' },
      { id: 'c', name: 'III. Coda personal' },
      { id: 'd', name: 'Bis' },
    ];
    const result = Catalog.completeWorkStructure({ id: 'prokofiev-7', composer: 'Prokofiev', name: 'Sonata n.º 7, Op. 83', movimientos: movements });
    expect(result.changed).toBe(false);
    expect(result.work.movimientos).toEqual(movements);
  });
});
