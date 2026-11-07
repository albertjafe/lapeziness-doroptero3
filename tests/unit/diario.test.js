import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const D = require('../../diario.js');
const M = require('../../daily-study-minutes.js');
const deps = { studyBlocks: M.studyBlocks };

// Hora local del 03-11-2026.
const at = (h, m = 0, day = 3) => new Date(2026, 10, day, h, m).toISOString();
const plant = (id, obraId, h1, m1, h2, m2, extra = {}) => ({
  id, obraId, movId: extra.movId || null, startedAt: at(h1, m1, extra.day), endedAt: at(h2, m2, extra.day),
  mins: (h2 * 60 + m2) - (h1 * 60 + m1), source: 'app', ...extra,
});
const base = () => ({
  obras: [
    { id: 'haydn', name: 'Sonata Hob. XVI:52', composer: 'Haydn', movimientos: [{ id: 'h1', name: 'I. Allegro' }, { id: 'h2', name: 'II. Adagio' }] },
    { id: 'chopin', name: 'Balada n.º 4', composer: 'Chopin' },
  ],
  sessionPlants: [
    plant('a', 'haydn', 10, 0, 10, 40, { movId: 'h1', notes: [{ text: 'mano izquierda más ligera', phaseLabel: 'min 12' }] }),
    plant('b', 'haydn', 10, 50, 11, 30, { movId: 'h2' }),
    plant('c', 'chopin', 12, 0, 12, 45),
    plant('d', 'chopin', 12, 50, 12, 58, { pase: true, pasePct: 82 }),
    plant('e', 'haydn', 16, 0, 16, 30),
    plant('x', 'haydn', 10, 0, 11, 0, { day: 2 }),
  ],
  sesiones: [],
  forestPlants: [],
  dailyJournalEntries: [],
});

describe('Diario: el día se rellena solo', () => {
  it('joins consecutive pieces of the same work, keeps pases apart and orders by time', () => {
    const day = D.day(base(), '2026-11-03', deps);
    expect(day.items.map(i => [i.kind, i.obraId, i.time, i.duration])).toEqual([
      ['study', 'haydn', '10:00–11:30', '1 h 20'],
      ['study', 'chopin', '12:00–12:45', '45 min'],
      ['pase', 'chopin', '12:50–12:58', '8 min'],
      ['study', 'haydn', '16:00–16:30', '30 min'],
    ]);
    const haydn = day.items[0];
    expect(haydn.key).toBe('p:a');
    expect(haydn.title).toBe('Haydn · Sonata Hob. XVI:52');
    expect(haydn.movs).toBe('I. Allegro, II. Adagio');
    expect(haydn.about).toBe('Haydn · Sonata Hob. XVI:52 · I. Allegro, II. Adagio · 10:00–11:30');
    expect(haydn.cronoNotes).toEqual([{ text: 'mano izquierda más ligera', label: 'min 12' }]);
    expect(day.items[2].pct).toBe(82);
    expect(day.items[2].about).toBe('Pase · Chopin · Balada n.º 4 · 12:50–12:58');
  });

  it('a pause longer than 20 min starts a new block', () => {
    const data = base();
    data.sessionPlants[1] = plant('b', 'haydn', 11, 1, 11, 30, { movId: 'h2' });
    const day = D.day(data, '2026-11-03', deps);
    expect(day.items.slice(0, 2).map(i => i.time)).toEqual(['10:00–10:40', '11:01–11:30']);
  });

  it('shows an empty day honestly', () => {
    const day = D.day(base(), '2026-11-01', deps);
    expect(day.items).toEqual([]);
    expect(day.general).toEqual([]);
  });
});

describe('Diario: libro de escritorio', () => {
  const today = '2026-11-06';

  it('the last spread has yesterday on the left and today on the right', () => {
    expect(D.spreadOf(today, today)).toEqual({ left: '2026-11-05', right: '2026-11-06' });
    expect(D.spreadOf('2026-11-05', today)).toEqual({ left: '2026-11-05', right: '2026-11-06' });
  });

  it('turning goes two days at a time and every day belongs to one spread', () => {
    expect(D.spreadOf('2026-11-04', today)).toEqual({ left: '2026-11-03', right: '2026-11-04' });
    expect(D.spreadOf('2026-11-03', today)).toEqual({ left: '2026-11-03', right: '2026-11-04' });
    expect(D.spreadOf('2026-11-02', today)).toEqual({ left: '2026-11-01', right: '2026-11-02' });
  });

  it('crosses months and the clock change, and never goes past today', () => {
    expect(D.spreadOf('2026-10-31', today).right).toBe('2026-10-31');
    expect(D.spreadOf('2026-10-24', '2026-10-26')).toEqual({ left: '2026-10-23', right: '2026-10-24' });
    expect(D.spreadOf('2026-11-20', today).right).toBe(today);
  });
});

describe('Diario: comentarios', () => {
  const now = new Date(2026, 10, 4, 9, 15);

  it('a comment belongs to its block and to the block day, even when written later', () => {
    const data = base();
    const id = D.write(data, { key: '2026-11-03', ref: 'p:a', about: 'Haydn · 10:00–11:30', text: 'El desarrollo sigue sucio' }, now);
    expect(data.dailyJournalEntries).toEqual([expect.objectContaining({ id, day: '2026-11-03', ref: 'p:a', about: 'Haydn · 10:00–11:30', text: 'El desarrollo sigue sucio' })]);
    const day = D.day(data, '2026-11-03', deps);
    expect(day.items[0].entries.map(e => e.text)).toEqual(['El desarrollo sigue sucio']);
    expect(day.general).toEqual([]);
    expect(D.day(data, '2026-11-04', deps).general).toEqual([]);
  });

  it('editing changes the same entry; emptying it only removes it when leaving the line', () => {
    const data = base();
    const id = D.write(data, { key: '2026-11-03', ref: 'p:a', about: 'x', text: 'Primera' }, now);
    expect(D.write(data, { id, key: '2026-11-03', ref: 'p:a', about: 'x', text: 'Primera idea' }, new Date(2026, 10, 4, 9, 16))).toBe(id);
    expect(data.dailyJournalEntries).toHaveLength(1);
    expect(data.dailyJournalEntries[0]).toMatchObject({ text: 'Primera idea', updatedAt: new Date(2026, 10, 4, 9, 16).toISOString() });
    // Borrar todo para reescribir no pierde nada mientras sigues en la línea.
    expect(D.write(data, { id, key: '2026-11-03', ref: 'p:a', text: '' })).toBe(id);
    expect(data.dailyJournalEntries).toHaveLength(1);
    expect(D.write(data, { id, key: '2026-11-03', ref: 'p:a', text: '  ', final: true })).toBe('');
    expect(data.dailyJournalEntries).toHaveLength(0);
  });

  it('general entries have no block; a comment whose block disappeared stays in the day', () => {
    const data = base();
    D.write(data, { key: '2026-11-03', text: 'Día cansado, pero concentrado' }, now);
    D.write(data, { key: '2026-11-03', ref: 'p:borrado', about: 'Chopin · 09:00–09:30', text: 'Esto no se pierde' }, now);
    const day = D.day(data, '2026-11-03', deps);
    expect(day.general.map(e => e.text)).toEqual(['Día cansado, pero concentrado', 'Esto no se pierde']);
    expect(day.items.every(i => i.entries.length === 0)).toBe(true);
  });

  it('old diary entries without day still land on their day', () => {
    const data = base();
    data.dailyJournalEntries.push({ id: 'old', at: at(21, 0), text: 'Entrada antigua' });
    expect(D.day(data, '2026-11-03', deps).general.map(e => e.id)).toEqual(['old']);
  });
});

describe('formato del diario (v528)', () => {
  it('«-» es tarea de hoy, «+» para otro día, «[x]» hecha; lo demás es texto', () => {
    expect(D.parseLine('- Comprar trenes')).toEqual({ kind: 'today', done: false, text: 'Comprar trenes' });
    expect(D.parseLine('- [x] LEEDS')).toEqual({ kind: 'today', done: true, text: 'LEEDS' });
    expect(D.parseLine('+ Regalo de mamá')).toEqual({ kind: 'later', done: false, text: 'Regalo de mamá' });
    expect(D.parseLine('-5 grados fuera').kind).toBe('text');
    expect(D.parseLine('Tareas para luego:').kind).toBe('text');
  });

  it('tras «Etiqueta:» el resto va aparte, pero no parte horas ni enlaces', () => {
    expect(D.splitAside('Programa: quita profesor')).toEqual(['Programa:', 'quita profesor']);
    expect(D.splitAside('Son las 9:52. Acabo de empezar')).toBeNull();
    expect(D.splitAside('Mira https://example.com')).toBeNull();
    expect(D.splitAside('Tareas para luego:')).toBeNull();
    expect(D.formatHtml('Programa: <b>')).toContain('<small class="dia-aside">&lt;b&gt;</small>');
  });

  it('numera cada lista de «-» desde 1 y la vuelve a empezar tras un texto', () => {
    const html = D.formatHtml('- a\n- b\nHecho\n- c\n+ d');
    expect([...html.matchAll(/dia-num">(\d+)\./g)].map(m => m[1])).toEqual(['1', '2', '1']);
  });

  it('marcar y desmarcar cambia solo esa línea', () => {
    const text = 'Hoy:\n- uno\n+ dos';
    expect(D.toggleLine(text, 1)).toBe('Hoy:\n- [x] uno\n+ dos');
    expect(D.toggleLine(D.toggleLine(text, 2), 2)).toBe(text);
    expect(D.toggleLine(text, 0)).toBe(text);
  });

  it('Intro sigue la lista y, en una línea vacía de la lista, la termina', () => {
    expect(D.continueList('- uno', 5)).toEqual({ value: '- uno\n- ', caret: 8 });
    expect(D.continueList('+ uno', 5)).toEqual({ value: '+ uno\n+ ', caret: 8 });
    expect(D.continueList('- [x] uno', 9)).toEqual({ value: '- [x] uno\n- ', caret: 12 });
    expect(D.continueList('a\n- ', 4)).toEqual({ value: 'a\n', caret: 2 });
    expect(D.continueList('texto', 5)).toBeNull();
  });
});
