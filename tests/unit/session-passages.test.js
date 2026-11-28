import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
globalThis.DiarioSections = require('../../diario-sections.js');
globalThis.Diario = require('../../diario.js');
const P = require('../../session-passages.js');

const fixture = () => ({
  obras: [{ id: 'w', name: 'Sonata', composer: 'C', movimientos: [{ id: 'm1', name: 'I' }, { id: 'm2', name: 'II' }] }],
  passageTracker: { passages: [{ id: 'oct', obraId: 'w', movId: 'm1', name: 'Octavas', difficulty: 8 }], observations: [] },
  journalSections: [{ id: 'coda', obraId: 'w', movId: 'm1', name: 'Coda' }, { id: 'intro', obraId: 'w', movId: 'm2', name: 'Intro' }],
  dailyJournalEntries: [],
});

describe('pasajes de la sesión', () => {
  it('lists the passages of a movement, or of the whole work', () => {
    const data = fixture();
    expect(P.choices(data, { obraId: 'w', movId: 'm1' }).map(r => r.name)).toEqual(['Coda', 'Octavas']);
    expect(P.choices(data, { obraId: 'w', movId: null }).map(r => r.name)).toEqual(['Coda', 'Intro', 'Octavas']);
  });

  it('writes one diary note with a section per passage and feeds the tracker curve', () => {
    const data = fixture();
    data.sessionPlants = [{ id: 'run_r1', runId: 'r1', obraId: 'w', movId: 'm1', startedAt: '2026-11-28T09:00:00.000Z', endedAt: '2026-11-28T09:30:00.000Z', mins: 30 }];
    const id = P.saveHecho(data, {
      run: { runId: 'r1', obraId: 'w', movId: 'm1' },
      plantId: 'run_r1', startedAt: '2026-11-28T09:00:00.000Z', endedAt: '2026-11-28T09:30:00.000Z',
      rows: [
        { id: 'oct', kind: 'passage', name: 'Octavas', obraId: 'w', movId: 'm1', rating: 'bien', note: 'la mano  suelta' },
        { id: 'coda', kind: 'section', name: 'Coda', obraId: 'w', movId: 'm1', rating: null, note: '' },
      ],
    }, new Date('2026-11-28T09:31:00.000Z'));
    const entry = data.dailyJournalEntries.find(e => e.id === id);
    expect(entry).toMatchObject({ ref: 'p:run_r1', text: '[[Octavas]]\nBien: la mano suelta\n[[Coda]]', obraId: 'w', movId: 'm1', source: 'crono-passages', runId: 'r1', ratings: { oct: 'bien' } });
    expect(entry.sectionRefs.map(r => r.id)).toEqual(['oct', 'coda']);
    expect(data.passageTracker.observations).toEqual([expect.objectContaining({ passageId: 'oct', score: 85, runId: 'r1', source: 'session-passages-v1' })]);
  });

  it('preselects the last note of that movement unless something newer was tapped here', () => {
    const data = fixture();
    data.dailyJournalEntries.push({ id: 'j1', at: '2026-11-28T10:00:00.000Z', source: 'crono-passages', obraId: 'w', movId: 'm1', sectionRefs: [{ id: 'coda' }, { id: 'gone' }] });
    const t = { obraId: 'w', movId: 'm1' };
    expect(P.defaultIds(data, t, null)).toEqual(['coda']);
    expect(P.defaultIds(data, { obraId: 'w', movId: 'm2' }, null)).toEqual([]);
    expect(P.defaultIds(data, t, { key: 'w|m1', ids: ['oct'], at: Date.parse('2026-11-28T11:00:00Z') })).toEqual(['oct']);
    expect(P.defaultIds(data, t, { key: 'w|m1', ids: ['oct'], at: Date.parse('2026-11-28T09:00:00Z') })).toEqual(['coda']);
  });

  it('formats the note text', () => {
    expect(P.noteText([{ name: 'A', rating: 'mal' }, { name: 'B', note: 'solo texto' }, { name: 'C' }])).toBe('[[A]]\nMal\n[[B]]\nsolo texto\n[[C]]');
  });
});
