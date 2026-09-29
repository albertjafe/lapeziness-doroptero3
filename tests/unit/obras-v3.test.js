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
