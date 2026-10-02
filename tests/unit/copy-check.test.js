import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DocumentSyncCore = require('../../document-sync-core.js');
const C = require('../../copy-check.js');

const now = () => ({
  obras: [{ id: 'w1', name: 'Bach', movimientos: [{ id: 'm1', name: 'Preludio' }] }],
  sessionPlants: [{ id: 'p1', obraId: 'w1', mins: 30, startedAt: '2026-10-01T09:00:00Z' }],
  germanStudy: { goals: [{ id: 'g-kindle', name: 'Kindle paperwhite', amount: 220 }], sessions: [] },
  cronoTasks: [{ id: 't1', text: 'Escalas' }],
});
const copy = () => ({
  obras: [{ id: 'w1', name: 'Bach', movimientos: [{ id: 'm1', name: 'Preludio' }, { id: 'm2', name: 'Fuga' }] }, { id: 'w2', name: 'Chopin' }],
  sessionPlants: [{ id: 'p1', obraId: 'w1', mins: 30, startedAt: '2026-10-01T09:00:00Z' }, { id: 'p2', obraId: 'w1', mins: 45, startedAt: '2026-10-02T09:00:00Z' }],
  germanStudy: { goals: [{ id: 'g-kindle', name: 'Kindle paperwhite', amount: 220 }, { id: 'g-banda', name: 'Banda pecho', amount: 90 }], sessions: [] },
  cronoTasks: [{ id: 't1', text: 'Escalas' }, { id: 't2', text: 'Borrada' }],
  dailyJournalEntries: [{ date: '2026-10-02', text: 'sin id' }],
});

describe('comprobar una copia', () => {
  it('encuentra lo que falta en cualquier nivel, también objetivos y movimientos', () => {
    const { missing } = C.compare({ rawData: copy() }, now());
    const labels = missing.map(m => C.area(m) + ': ' + C.describe(m));
    expect(labels).toEqual(expect.arrayContaining([
      'Obras: Chopin', 'Movimientos: Fuga', 'Objetivos (hucha): Banda pecho · 90 €',
      'Bloques de estudio: 2026-10-02 09:00 · 45 min', 'Tareas: Borrada',
    ]));
    expect(missing.find(m => C.area(m) === 'Diario').anonymous).toBe(true);
  });

  it('lee la copia completa del rescate: memoria, localStorage e IndexedDB', () => {
    const file = {
      formato: 'copia-completa-app', memory: now(),
      localStorage: { alberto_piano_v2: JSON.stringify(copy()), otra: 'x' },
      indexedDB: { piano_pre_update_rescue_v1: { snapshots: { keys: [1], values: [{ capturedAt: 'x', raw: JSON.stringify({ ...now(), cronoTasks: [{ id: 't9', text: 'Solo en IDB' }] }) }] } } },
    };
    const result = C.compare(file, now());
    expect(result.copies).toHaveLength(3);
    expect(result.missing.map(m => m.item.text).filter(Boolean)).toEqual(expect.arrayContaining(['Borrada', 'Solo en IDB']));
    expect(result.missing.filter(m => m.id === 'id:g-banda')).toHaveLength(1);
  });

  it('recuperar solo añade, no duplica y respeta los borrados a propósito', () => {
    const current = now();
    current.cronoTaskTombstones = [{ id: 't2', deletedAt: '2026-10-01' }];
    current.germanStudy._deletedChildren = { goals: {} };
    const { missing } = C.compare({ data: copy() }, current);
    expect(missing.find(m => m.id === 'id:t2').tombstoned).toBe(true);
    const before = JSON.stringify(current.sessionPlants[0]);
    const added = C.restore(current, missing);
    expect(current.germanStudy.goals.map(g => g.name)).toEqual(['Kindle paperwhite', 'Banda pecho']);
    expect(current.obras[0].movimientos.map(m => m.id)).toEqual(['m1', 'm2']);
    expect(current.obras.map(o => o.id)).toEqual(['w1', 'w2']);
    expect(current.cronoTasks.map(t => t.id)).toEqual(['t1']);
    expect(current.dailyJournalEntries).toBeUndefined();
    expect(JSON.stringify(current.sessionPlants[0])).toBe(before);
    expect(added).toBe(4);
    expect(C.restore(current, missing)).toBe(0);
    expect(C.compare({ data: copy() }, current).missing.filter(m => !m.tombstoned && !m.anonymous)).toEqual([]);
  });

  it('una copia igual a la app no tiene nada que recuperar', () => {
    expect(C.compare({ memory: now() }, now()).missing).toEqual([]);
    expect(() => C.compare({ hola: 1 }, now())).toThrow(/No encuentro/);
  });
});
