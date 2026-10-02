import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const C = require('../../concursos-dossier.js');
const DocumentSyncCore = require('../../document-sync-core.js');
const seed = JSON.parse(fs.readFileSync('data/concursos-dosier.json', 'utf8'));
const byId = id => C.normalize(seed.concursos.find(c => c.id === id));
const BIRTH = '1999-02-19';

describe('dosier de concursos: datos', () => {
  it('el dosier inicial es válido, sin ids repetidos y con fuentes', () => {
    const parsed = C.parse(JSON.stringify(seed));
    expect(parsed.errors).toEqual([]);
    expect(parsed.items).toHaveLength(24);
    for (const item of parsed.items) expect(item.fuentes.length).toBeGreaterThan(0);
  });

  it('acepta un array o una ficha suelta y rechaza ids malos sin perder el resto', () => {
    const one = seed.concursos[0];
    expect(C.parse(JSON.stringify(one)).items).toHaveLength(1);
    const mixed = C.parse([one, { id: 'Mal Id', nombre: 'x' }]);
    expect(mixed.items).toHaveLength(1);
    expect(mixed.errors[0]).toMatch(/Id no válido/);
    expect(() => C.parse('{nope')).toThrow(/JSON/);
    expect(() => C.parse({ formato: 'otro', concursos: [one] })).toThrow(/Formato/);
  });
});

describe('edad y elegibilidad (19-02-1999)', () => {
  it('calcula la edad exacta en una fecha', () => {
    expect(C.ageAt(BIRTH, '2027-02-18')).toBe(27);
    expect(C.ageAt(BIRTH, '2027-02-19')).toBe(28);
  });
  it('rango de nacimiento, edad a una fecha y sin límite', () => {
    expect(C.eligibility(byId('montreal-2027'), BIRTH).state).toBe('yes');
    expect(C.eligibility(byId('clara-haskil-2027'), BIRTH).state).toBe('yes');
    const canals = C.eligibility(byId('maria-canals-2027'), BIRTH);
    expect(canals).toMatchObject({ state: 'yes', age: 27, ref: '2027-01-01' });
    expect(C.eligibility(byId('international-german-piano-award-2026'), BIRTH).label).toBe('Sin límite de edad');
    expect(C.eligibility(byId('pozzoli-2027'), BIRTH).state).toBe('unknown');
  });
  it('detecta quien se queda fuera por edad', () => {
    expect(C.eligibility(byId('clara-haskil-2027'), '1998-09-03').state).toBe('no');
    expect(C.eligibility(byId('maria-canals-2027'), '1996-12-31').state).toBe('no');
    expect(C.eligibility(byId('maria-canals-2027'), '1997-01-02').state).toBe('yes');
  });
  it('marca como provisional una regla sin confirmar', () => {
    expect(C.eligibility(byId('ciurlionis-2027'), BIRTH)).toMatchObject({ state: 'yes', tentative: true });
  });
});

describe('plazos', () => {
  it('días que quedan, cerrado y terminado', () => {
    const canals = byId('maria-canals-2027');
    expect(C.deadlineStatus(canals, '2026-11-20')).toMatchObject({ state: 'urgent', days: 3 });
    expect(C.deadlineStatus(canals, '2026-10-02')).toMatchObject({ state: 'open', days: 52 });
    expect(C.deadlineStatus(canals, '2026-10-20')).toMatchObject({ state: 'soon', days: 34 });
    expect(C.deadlineStatus(canals, '2026-11-24').state).toBe('closed');
    expect(C.deadlineStatus(canals, '2027-03-19').state).toBe('finished');
    expect(C.deadlineStatus(byId('istanbul-orchestrasion-2026'), '2026-10-02').state).toBe('closed');
    expect(C.deadlineStatus(byId('pozzoli-2027'), '2026-10-02').state).toBe('pending');
  });
  it('ordena primero los plazos abiertos más cercanos', () => {
    const items = seed.concursos.map(C.normalize).sort((a, b) => C.compare(a, b, '2026-10-02'));
    expect(items.slice(0, 2).map(c => c.id).sort()).toEqual(['campillos-2026', 'international-german-piano-award-2026']);
    expect(items.at(-1).id).not.toBe('campillos-2026');
  });
});

describe('importar y sincronizar', () => {
  it('reimportar sustituye la ficha entera y conserva el interés', () => {
    const state = { concursos: [] };
    const first = C.parse(JSON.stringify(seed)).items;
    expect(C.merge(state, first, { now: 't1' })).toEqual({ added: 24, updated: 0, unchanged: 0 });
    state.concursos.find(r => r.id === 'montreal-2027').interes = 'si';
    const changed = JSON.parse(JSON.stringify(seed.concursos.find(c => c.id === 'montreal-2027')));
    changed.rondas = changed.rondas.slice(0, 1);
    expect(C.merge(state, C.parse(changed).items, { now: 't2' })).toEqual({ added: 0, updated: 1, unchanged: 0 });
    const record = state.concursos.find(r => r.id === 'montreal-2027');
    expect(record.interes).toBe('si');
    expect(C.fichaOf(record).rondas).toHaveLength(1);
  });
  it('el seed no pisa una ficha verificada después', () => {
    const state = { concursos: [] };
    const newer = JSON.parse(JSON.stringify(seed.concursos[0]));
    newer.verificado = '2027-01-01'; newer.premiosNota = 'nuevo';
    C.merge(state, C.parse(newer).items);
    expect(C.merge(state, C.parse(seed.concursos[0]).items, { onlyNewer: true }).unchanged).toBe(1);
    expect(C.fichaOf(state.concursos[0]).premiosNota).toBe('nuevo');
  });
  it('la ficha es un escalar: la fusión con la nube no mezcla rondas viejas y nuevas', () => {
    const base = { concursosDosier: { concursos: [] } };
    C.merge(base.concursosDosier, C.parse(seed.concursos.find(c => c.id === 'leeds-2027')).items, { now: 't1' });
    const server = DocumentSyncCore.track(JSON.parse(JSON.stringify(base)), {}, '2026-10-02T10:00:00Z');
    const local = JSON.parse(JSON.stringify(server));
    const edited = JSON.parse(JSON.stringify(seed.concursos.find(c => c.id === 'leeds-2027')));
    edited.rondas = [{ nombre: 'Única', repertorio: ['x'] }];
    C.merge(local.concursosDosier, C.parse(edited).items, { now: 't2' });
    const tracked = DocumentSyncCore.track(local, server, '2026-10-02T11:00:00Z');
    const merged = DocumentSyncCore.mergeRemote(server, tracked);
    expect(C.fichaOf(merged.concursosDosier.concursos[0]).rondas).toEqual([{ nombre: 'Única', fecha: null, duracion: null, repertorio: ['x'] }]);
  });
  it('convierte la ficha al formato de la planificación', () => {
    const plan = C.toPlan(byId('maria-canals-2027'), '2026-10-02');
    expect(plan).toMatchObject({ id: 'maria-canals-2027', start: '2027-03-07', end: '2027-03-18', deadline: '2026-11-23', requiresVideo: true });
    expect(plan.prizes).toContain('25.000 EUR');
  });
});
