import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const O = require('../../obras-v3.js');
const strip = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const bootstrap = readFileSync(new URL('../../piano-rooms.js', import.meta.url), 'utf8');

describe('obras v3 · estudio real', () => {
  const plants = [
    { obraId: 'w1', movId: 'm1', mins: 30, startedAt: '2026-09-28T10:00:00Z' },
    { obraId: 'w1', movId: 'm2', mins: 20, startedAt: '2026-08-01T10:00:00Z' },
    { obraId: 'w1', mins: 10, startedAt: '2026-09-29T08:00:00Z', failed: true },
    { obraId: '_rest_', mins: 5, startedAt: '2026-09-29T08:00:00Z', tipo: 'descanso' },
  ];
  it('counts minutes from plants (not planned cards), per work and movement, and the last 30 days', () => {
    const index = O.addRecent(O.studyIndex(plants), plants, Date.parse('2026-09-29T12:00:00Z'));
    expect(index.works.w1).toMatchObject({ minutes: 50, recent: 30, last: Date.parse('2026-09-28T10:00:00Z') });
    expect(index.movs['w1::m2'].minutes).toBe(20);
    expect(index.works._rest_).toBeUndefined();
  });
});

describe('obras v3 · eventos y prioridad', () => {
  const events = [
    { id: 'e1', nombre: 'Clase', fecha: '2026-10-01', obras: ['w1'] },
    { id: 'e0', nombre: 'Pasado', fecha: '2026-09-01', obras: ['w1'] },
    { id: 'e2', nombre: 'Recital', fecha: '2026-11-20', obras: [{ id: 'w1' }] },
    { id: 'e3', nombre: 'Hecho', fecha: '2026-09-30', obras: ['w1'], completado: true },
  ];
  it('finds the nearest upcoming, not completed event of a work', () => {
    expect(O.nextEvent(events, 'w1', '2026-09-29')).toMatchObject({ name: 'Clase', days: 2 });
    expect(O.nextEvent(events, 'w2', '2026-09-29')).toBeNull();
  });
  it('sorts by priority and by the chosen criterion', () => {
    const now = Date.parse('2026-09-29T12:00:00Z');
    const a = { work: { id: 'a', name: 'Alfa', composer: 'Zeta' }, score: 30, last: now - 20 * 864e5, now, event: null };
    const b = { work: { id: 'b', name: 'Beta', composer: 'Alfa' }, score: 90, last: 0, now, event: { days: 3 } };
    const c = { work: { id: 'c', name: 'Gamma', composer: 'Beta' }, score: null, last: 0, now, event: null };
    [a, b, c].forEach(i => { i.priority = O.priority(i); });
    expect(c.priority).toBe(0);
    expect(O.sortWorks([a, b, c], 'smart').map(i => i.work.id)).toEqual(['b', 'a', 'c']);
    expect(O.sortWorks([a, b, c], 'composer').map(i => i.work.id)).toEqual(['b', 'c', 'a']);
    expect(O.sortWorks([a, b, c], 'solidity').map(i => i.work.id)).toEqual(['c', 'a', 'b']);
  });
  it('searches titles, composers and movement names ignoring accents', () => {
    const w = { name: 'Sonata', composer: 'Bartók', movimientos: [{ name: 'Sostenuto e pesante' }] };
    expect(O.matches(w, 'bartok')).toBe(true);
    expect(O.matches(w, 'sonata sosten')).toBe(true);
    expect(O.matches(w, 'mozart')).toBe(false);
  });
});

describe('obras v3 · ficha', () => {
  const work = { id: 'w1', name: 'Concierto n.º 1', composer: 'Tchaikovsky', duracion: 35, movimientos: [{ id: 'm1', name: 'I. Allegro', duracion: 20, duracionEstimada: true }], esc: 70, paseHistory: [{}], learningStage: 'consolidando' };
  const ctx = { work, score: 61, status: 'Sólida', minutes: 516, recent: 516, last: Date.parse('2026-09-23T10:00:00Z'), now: Date.parse('2026-09-29T10:00:00Z'), event: null,
    difficulty: { score: 9, label: 'Virtuosismo extremo' }, movements: [{ mov: work.movimientos[0], score: 60, minutes: 211 }], pred: '', enrich: false };
  it('shows solidity, real study, difficulty once, practice and movements; never stage, scene or passes', () => {
    const text = strip(O.sheetViewHtml(ctx));
    expect(text).toContain('Tchaikovsky Concierto n.º 1 35 min · 1 movimiento · técnica 9,0/10 · virtuosismo extremo');
    expect(text).toContain('Solidez 61% Sólida');
    expect(text).toContain('Estudiado 8 h 36 min todo en los últimos 30 días');
    expect(text).toContain('Práctica hace 6 d última práctica');
    expect(text).toContain('I. Allegro ≈ 20 min · 3 h 31 min estudiados 60%');
    expect(text).toContain('▶ Estudiar ahora Registrar solidez Historial');
    expect(text).not.toMatch(/Escena|Pases|Consolidando/);
    expect((O.sheetViewHtml(ctx).match(/data-action="close"/g) || []).length).toBe(1);
    expect(O.sheetViewHtml({ ...ctx, inline: true })).not.toContain('data-action="close"');
  });
  it('edit form keeps the ids the rest of the app and tests rely on', () => {
    const html = O.sheetEditHtml(work, { difficulty: 9 });
    ['obraPremiumName', 'obraPremiumComposer', 'obraPremiumDuration', 'obraPremiumDifficulty', 'obraPremiumNotes'].forEach(id => expect(html).toContain('id="' + id + '"'));
    expect(html).toContain('data-mov-field="duracion"');
    expect(strip(html)).toContain('Eliminar Cancelar Guardar cambios');
  });
  it('replaces the five old layers in the bootstrap', () => {
    expect(bootstrap).toContain('./obras-v3.js?v=');
    expect(bootstrap).not.toMatch(/obra-premium\.js|obras-redesign\.js|obras-unified-library\.js/);
  });
});

describe('obras v3 · obras sin ficha', () => {
  const Doc = require('../../document-sync-core.js');
  const DataCore = require('../../data-core.js');
  const Ledger = require('../../study-ledger-sync.js');
  globalThis.DocumentSyncCore = Doc; // el historial maestro lo busca en el global, como en la app
  const doc = () => ({
    obras: [{ id: 'oNew', name: "Reflets dans l'eau, Images, Book I, L.110/1", composer: 'Debussy', movimientos: [] }, { id: 'x', name: 'Otra', composer: 'Bach' }],
    sessionPlants: [
      { id: 'run_a', obraId: 'oOld', movId: 'mGone', mins: 300, startedAt: '2026-09-07T17:00:00Z', endedAt: '2026-09-07T22:00:00Z' },
      { id: 'run_b', obraId: 'oOld', mins: 25, startedAt: '2026-09-21T07:00:00Z', endedAt: '2026-09-21T07:25:00Z' },
      { id: 'run_c', obraId: 'oRam', mins: 52, startedAt: '2026-09-10T09:00:00Z', endedAt: '2026-09-10T09:52:00Z' },
      { id: 'run_d', obraId: 'oNew', mins: 49, startedAt: '2026-09-29T11:00:00Z', endedAt: '2026-09-29T11:49:00Z' },
      { obraId: 'oLegacy', mins: 10, startedAt: '2026-01-01T10:00:00Z' },
      { id: 'rest', obraId: '_rest_', mins: 5, startedAt: '2026-09-29T12:00:00Z' },
    ],
    sesiones: [{ fecha: '2026-09-10', items: [{ obraId: 'oRam', obraName: 'Hommage à Rameau, Images, Book I, L.110/2' }, { obraId: 'oOld', obraName: "Reflets dans l'eau, Images, Book I, L.110/1" }] }],
  });

  it('finds study without a work, named from the history, and suggests the same title', () => {
    const d = doc();
    const list = O.orphans(d, Date.parse('2026-09-29T12:00:00Z'));
    expect(list.map(o => [o.id, o.name, o.minutes, o.count, o.recent])).toEqual([
      ['oOld', "Reflets dans l'eau, Images, Book I, L.110/1", 325, 2, true],
      ['oRam', 'Hommage à Rameau, Images, Book I, L.110/2', 52, 1, true],
    ]);
    expect(O.suggestedMatch(d.obras, list[0]).id).toBe('oNew');
    expect(O.suggestedMatch(d.obras, list[1])).toBeNull();
    expect(O.orphanMeta(list[0])).toBe('5 h 25 min · 2 tramos · 7 sep – 21 sep');
    const html = strip(O.orphansHtml(list, d.obras));
    expect(html).toContain('Parece la misma que «Reflets dans l&#039;eau, Images, Book I, L.110/1»: únelas');
    d.obrasSinFichaOcultas = { oRam: '2026-09-29T12:00:00Z' };
    expect(O.orphans(d).find(o => o.id === 'oRam').hidden).toBe(true);
  });

  it('recovering keeps the id so all its study comes back', () => {
    const d = doc();
    d.obras.push(O.recoveredWork(O.orphans(d).find(o => o.id === 'oRam'), '2026-09-29T12:00:00Z'));
    expect(d.obras.at(-1)).toMatchObject({ id: 'oRam', name: 'Hommage à Rameau, Images, Book I, L.110/2', tipo: 'obra', recoveredAt: '2026-09-29T12:00:00Z' });
    expect(O.orphans(d).map(o => o.id)).toEqual(['oOld']);
  });

  it('joining moves the study with a field clock that survives merges with an old copy, without duplicates', () => {
    const old = doc();
    const edited = doc();
    const target = edited.obras[0];
    expect(O.moveStudy(edited, 'oOld', 'oNew', '2026-09-29T12:30:00Z', target)).toBe(2);
    expect(edited.sessionPlants[0]).toMatchObject({ obraId: 'oNew', movId: null, _fieldClock: { obraId: '2026-09-29T12:30:00Z', movId: '2026-09-29T12:30:00Z' } });
    // Documento: fusión en ambos sentidos con una copia que aún tiene la obra vieja.
    for (const merged of [Doc.merge(old, edited), Doc.merge(edited, old), Doc.mergeRemote(old, edited)]) {
      const plants = merged.sessionPlants.filter(p => p.id === 'run_a' || p.id === 'run_b');
      expect(plants.map(p => p.obraId)).toEqual(['oNew', 'oNew']);
    }
    const domain = DataCore.mergeStudyHistory(edited, old);
    expect(domain.sessionPlants.filter(p => p.id === 'run_a')).toHaveLength(1);
    // Historial maestro: el tramo editado se sube y otro dispositivo lo aplica.
    const rows = Ledger.pendingRows(edited, {}, 'u', '2026-09-29T12:31:00Z').filter(r => r.record_key === 'id:run_a');
    expect(rows).toHaveLength(1);
    const phone = doc();
    const pushed = { ['sessionPlants\u0000id:run_a']: Ledger.fingerprint(phone.sessionPlants[0]) };
    Ledger.applyRows(phone, rows, pushed);
    expect(phone.sessionPlants.filter(p => p.id === 'run_a').map(p => p.obraId)).toEqual(['oNew']);
    expect(O.orphans(edited).map(o => o.id)).toEqual(['oRam']);
  });
});
