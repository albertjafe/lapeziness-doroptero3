import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Handoff = require('../../professor-handoff-resilience.js');

function unit(i) {
  return {
    key: `obra-${i}::mov-${i}`,
    obraId: `obra-${i}`,
    movId: `mov-${i}`,
    composer: `Composer ${i}`,
    work: `Work ${i}`,
    movement: `Movement ${i}`,
    difficulty: 5 + (i % 5) * 0.7,
    solidity: 40 + (i % 55),
    daysSinceEvidence: i % 31,
    evidenceKind: 'solidez',
    evidenceAt: '2026-09-01T10:00:00.000Z',
    lastStudyAt: '2026-09-03T10:00:00.000Z',
    daysSinceStudy: i % 12,
    recent: { today: i % 50, d3: 60 + i, d7: 100 + i, d14: 180 + i, d30: 260 + i, d90: 500 + i, all: 900 + i },
    historicalWorkHours: 10 + i,
    workUnallocatedModernMinutes: i,
    movementModernMinutes: 500 + i,
    recoveryHours: { low: 0.5 + i / 100, high: 1.5 + i / 100, source: 'test', target: 82 },
    priority: { band: i < 10 ? 'urgente' : 'media', score: 90 - (i % 50), reasons: [`razón ${i}`, 'retención'] },
    linkedEvents: [{ key: `internal:event-${i % 68}`, name: `Event ${i % 68}` }],
    lastPass: { at: '2026-08-30T10:00:00.000Z', score: 70 + (i % 20), type: 'pase' },
    workState: 'recuperación',
    movementState: 'activo',
  };
}

function event(i) {
  return {
    key: `internal:event-${i}`,
    id: `event-${i}`,
    day: `2026-${String(9 + Math.floor(i / 28)).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`,
    daysAway: i + 1,
    source: 'app',
    type: i % 2 ? 'concurso' : 'examen',
    repertoireLinked: true,
    workIds: [`obra-${i % 80}`],
    movementTargets: { [`obra-${i % 80}`]: [`mov-${i % 80}`] },
    name: `EVENT_SENTINEL_${i}`,
  };
}

describe('ProfessorHandoffResilience', () => {
  it('sends all units and events without ever building the giant legacy prompt', () => {
    const core = {
      buildPrompt: () => { throw new Error('legacy giant prompt must never be built'); },
      DEFAULT_MASTER_PROMPT: 'default',
    };
    const report = {
      asOf: '2026-09-04T10:30:00.000Z',
      today: { totalKnownMinutes: 140, movementMinutes: 130, unallocatedMinutes: 10, unitsStudied: 3, byUnit: [] },
      coverage: { units: 80, internalFutureEvents: 68 },
      warnings: ['warning sentinel'],
      units: Array.from({ length: 80 }, (_, i) => unit(i)),
      events: Array.from({ length: 68 }, (_, i) => event(i)),
    };

    const built = Handoff.buildSafeChatGptUrl(report, { mode: 'today', masterPrompt: 'default' }, core);

    expect(built.truncated).toBe(false);
    expect(built.compressed).toBe(true);
    expect(built.unitCount).toBe(80);
    expect(built.eventCount).toBe(68);
    expect(built.promptForUrl).toContain('obra-0::mov-0');
    expect(built.promptForUrl).toContain('obra-79::mov-79');
    expect(built.promptForUrl).toContain('EVENT_SENTINEL_0');
    expect(built.promptForUrl).toContain('EVENT_SENTINEL_67');
    expect(built.promptForUrl.match(/^U\|/gm)).toHaveLength(80);
    // Partial linked-event objects with differing names are preserved as separate
    // dictionary entries; they must not be silently replaced by a namesake.
    expect(Handoff.decodeContext(Handoff.denseContext(report))).toEqual(report);
    expect(built.transport).toBe('clipboard');
    expect(built.url.length).toBeLessThan(Handoff.MAX_URL_ENCODED);
    expect(built.fullPrompt).toBeUndefined();
  });

  it('preserves a genuinely custom professor instruction without duplicating the default prompt', () => {
    const report = {
      asOf: '2026-09-04T10:30:00.000Z',
      today: { totalKnownMinutes: 0, movementMinutes: 0, unallocatedMinutes: 0, unitsStudied: 0, byUnit: [] },
      coverage: {}, warnings: [], units: [unit(0)], events: [event(0)],
    };
    const built = Handoff.buildSafeChatGptUrl(report, {
      mode: 'now',
      masterPrompt: 'Da prioridad extra a mi condición personalizada.',
    }, { DEFAULT_MASTER_PROMPT: 'otro texto por defecto' });

    expect(built.promptForUrl).toContain('REGLAS_PERSONALES');
    expect(built.promptForUrl).toContain('Da prioridad extra a mi condición personalizada.');
    expect(built.promptForUrl).toContain('dime qué estudiar AHORA');
  });
});
