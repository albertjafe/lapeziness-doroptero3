import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../obra-grouping-migration.js');

const piece = (id, name, extra = {}) => ({ id, name, composer: 'Claude Debussy', tipo: 'obra', movimientos: [], sol: 60,
  solHistory: [{ date: '2026-10-01', val: 55, obraId: id }], paseHistory: [{ id: 'p' + id, date: '2026-10-02', tipo: 'solo' }],
  zoneHistory: [{ obraId: id, at: '2026-10-03' }], dificultad: 7, createdAt: '2026-09-29T10:00:00Z', _fieldClock: { sol: 'x' }, ...extra });
const db = () => ({
  obras: [{ id: 'other', name: 'Otra', movimientos: [] }, piece('o1790682725273', 'Reflets'), piece('o1788778666960', 'Hommage', { sol: 62 }), piece('o1790871529608', 'Mouvement', { sol: 68 })],
  sessionPlants: [{ id: 's1', obraId: 'o1788778666960', mins: 20 }, { id: 's2', obraId: 'other', mins: 10 }],
  sesiones: [{ date: '2026-10-10', items: [{ obraId: 'o1790871529608', _planId: 'pase_o1790871529608_1', min: 15 }] }],
  eventos: [{ id: 'e1', obras: ['o1790682725273', 'o1788778666960', 'other'] }],
});

describe('agrupar Images I como movimientos', () => {
  it('turns the three pieces into ordered movements that keep their history', () => {
    const d = db();
    expect(M.migrateDatabase(d, new Date('2026-10-19T10:00:00Z'))).toBeGreaterThan(0);
    expect(d.obras.map(o => o.id)).toEqual(['other', 'debussy-images-1']);
    const parent = d.obras[1];
    expect(parent).toMatchObject({ name: 'Images I, L.110', composer: 'Claude Debussy', tipo: 'obra', sol: 63 });
    expect(parent.movimientos.map(m => [m.id, m.name])).toEqual([
      ['o1790682725273', 'I. Reflets dans l\'eau'], ['o1788778666960', 'II. Hommage à Rameau'], ['o1790871529608', 'III. Mouvement']]);
    const reflets = parent.movimientos[0];
    expect(reflets.paseHistory).toHaveLength(1);
    expect(reflets.dificultad).toBe(7);
    expect(reflets.tipo).toBeUndefined();
    expect(reflets._fieldClock).toBeUndefined();
    expect(reflets.solHistory[0]).toMatchObject({ obraId: 'debussy-images-1', movId: 'o1790682725273' });
  });

  it('moves every reference to the group and its movement', () => {
    const d = db();
    M.migrateDatabase(d);
    expect(d.sessionPlants[0]).toMatchObject({ obraId: 'debussy-images-1', movId: 'o1788778666960' });
    expect(d.sessionPlants[1]).toMatchObject({ obraId: 'other' });
    expect(d.sessionPlants[1].movId).toBeUndefined();
    expect(d.sesiones[0].items[0]).toMatchObject({ obraId: 'debussy-images-1', movId: 'o1790871529608' });
    expect(d.eventos[0].obras).toEqual(['debussy-images-1', 'other']);
  });

  it('is idempotent and later fixes stray references from an older device', () => {
    const d = db();
    M.migrateDatabase(d);
    const once = JSON.stringify(d);
    expect(M.migrateDatabase(d)).toBe(0);
    expect(JSON.stringify(d)).toBe(once);
    d.sessionPlants.push({ id: 's3', obraId: 'o1790682725273', mins: 11 });
    expect(M.migrateDatabase(d, new Date(), false)).toBe(0);   // la pasada barata no recorre el historial
    expect(M.migrateDatabase(d)).toBe(1);
    expect(d.sessionPlants[2]).toMatchObject({ obraId: 'debussy-images-1', movId: 'o1790682725273' });
  });
});
