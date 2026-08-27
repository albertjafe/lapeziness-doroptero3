import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Readiness = require('../../readiness-core.js');

const obra = (extra = {}) => ({ id: 'bach', name: 'Bach', tipo: 'obra', sol: 50, ...extra });
const dbWith = (o, sesiones = [], extras = {}) => ({ obras: [o], sesiones, ...extras });
const item = (date, minutes, extra = {}) => ({ obraId: 'bach', minutosReales: minutes, endedAt: date, ...extra });

describe('ReadinessCore', () => {
  it('does not estimate activity records', () => {
    expect(Readiness.estimateReadiness(dbWith(obra({ tipo: 'actividad' })), 'bach')).toBeNull();
  });

  it('does not use minutosExtra or historical hours as elapsed checkpoint minutes', () => {
    const db = dbWith(obra({ sol: 40, minutosExtra: 30000, historicalSourceId: 'old' }), [
      { id: 'session-1', date: '2026-01-01', items: [item('2026-01-01T10:00:00Z', 10, { solRating: 40 })] },
      { id: 'session-2', date: '2026-01-02', items: [item('2026-01-02T10:00:00Z', 10, { solRating: 60 })] },
    ], { historicalRepertoire: [{ id: 'old', estimatedHours: 500 }] });
    const result = Readiness.estimateReadiness(db, 'bach');
    expect(result.diagnostics.timestampedMinutes).toBe(20);
    expect(result.diagnostics.realMinutes).toBe(20);
    expect(result.diagnostics.familiarity.hours).toBeGreaterThan(0);
    expect(result.diagnostics.timeline.practice.map(entry => entry.sessionId)).toEqual(['session-1', 'session-2']);
    expect(result.diagnostics.speed.source).not.toBe('obra+global');
  });

  it('returns a wide valid range and low confidence for sparse data', () => {
    const result = Readiness.estimateReadiness(dbWith(obra({ sol: 0, minutosExtra: 6000 })),'bach');
    expect(result.confidence).toBe('low');
    expect(result.lowMinutes).toBeGreaterThanOrEqual(0);
    expect(result.lowMinutes).toBeLessThanOrEqual(result.pointEstimateMinutes);
    expect(result.pointEstimateMinutes).toBeLessThanOrEqual(result.highMinutes);
    expect([result.lowMinutes, result.pointEstimateMinutes, result.highMinutes].every(Number.isFinite)).toBe(true);
  });

  it('requires stability and blocks a weak movement', () => {
    const movements = [{ id: 'one', duracion: 1 }, { id: 'two', duracion: 1 }];
    const sessions = ['2026-08-01', '2026-08-10'].map((date, index) => ({ date, items: [item(date + 'T10:00:00Z', 30, { movId: index ? 'one' : 'two', solRating: index ? 90 : 55 })] }));
    const result = Readiness.estimateReadiness(dbWith(obra({ movimientos: movements }), sessions), 'bach');
    expect(result.isReady).toBe(false);
    expect(result.factors).toContain('cuello de botella en movimientos');
  });

  it('does not treat a passage rating as whole-work readiness', () => {
    const db = dbWith(obra({ sol: 80 }), [
      { date: '2026-08-01', items: [item('2026-08-01T10:00:00Z', 30, { solRating: 80, zone: 'pasaje' })] },
    ]);
    const result = Readiness.estimateReadiness(db, 'bach');
    expect(result.isReady).toBe(false);
    expect(result.coverage).toBeLessThan(0.8);
  });

  it('uses historical peak as a bounded recovery prior', () => {
    const fresh = Readiness.estimateReadiness(dbWith(obra({ sol: 40 })), 'bach');
    const recovered = Readiness.estimateReadiness(dbWith(obra({ sol: 40, origen: 'recuperacion', historicalSourceId: 'old' }), [], {
      historicalRepertoire: [{ id: 'old', estimatedHours: 500, peakLevel: 90, lastPlayedYear: 2025 }],
    }), 'bach');
    expect(recovered.pointEstimateMinutes).toBeLessThan(fresh.pointEstimateMinutes);
    expect(recovered.pointEstimateMinutes).toBeGreaterThan(0);
    expect(recovered.diagnostics.familiarity.peakLevel).toBe(90);
  });

  it('uses categorical historical levels and legacy 1-10 scores without leaking hours', () => {
    const result = Readiness.estimateReadiness(dbWith(obra({ sol: 4, origen: 'recuperacion', historicalSourceId: 'old' }), [], {
      historicalRepertoire: [{ id: 'old', estimatedHours: 200, peakLevel: 'publico', lastPlayedYear: 2025 }],
    }), 'bach');
    expect(result.rawScore).toBe(40);
    expect(result.diagnostics.familiarity.peakLevel).toBe(90);
    expect(result.diagnostics.realMinutes).toBe(0);
  });

  it('uses timestamped session plants and only the residual daily-session minutes', () => {
    const db = dbWith(obra(), [{ id: 'day', date: '2026-08-01', items: [item('2026-08-01T11:00:00Z', 50)] }], {
      sessionPlants: [
        { id: 'plant-1', obraId: 'bach', movId: null, mins: 20, startedAt: '2026-08-01T10:00:00Z', endedAt: '2026-08-01T10:20:00Z' },
        { id: 'plant-2', obraId: 'bach', movId: null, mins: 20, startedAt: '2026-08-01T10:30:00Z', endedAt: '2026-08-01T10:50:00Z' },
      ],
    });
    const result = Readiness.estimateReadiness(db, 'bach');
    expect(result.diagnostics.realMinutes).toBe(50);
    expect(result.diagnostics.timestampedMinutes).toBe(50);
    expect(result.diagnostics.timeline.practice.map(entry => entry.minutes)).toEqual([20, 20, 10]);
  });

  it('reconciles a shared plant budget across multiple daily-session items', () => {
    const db = dbWith(obra(), [{ id: 'day', date: '2026-08-01', items: [
      item('2026-08-01T11:00:00Z', 40),
      item('2026-08-01T12:00:00Z', 20),
    ] }], {
      sessionPlants: [
        { id: 'plant-1', obraId: 'bach', mins: 40, endedAt: '2026-08-01T10:40:00Z' },
        { id: 'plant-2', obraId: 'bach', mins: 20, endedAt: '2026-08-01T10:55:00Z' },
      ],
    });
    const result = Readiness.estimateReadiness(db, 'bach');
    expect(result.diagnostics.realMinutes).toBe(60);
    expect(result.diagnostics.timeline.practice.map(entry => entry.minutes)).toEqual([40, 20]);
  });

  it('includes legacy forest plants as timestamped real practice', () => {
    const result = Readiness.estimateReadiness(dbWith(obra(), [], {
      forestPlants: [{ id: 'forest-1', obraId: 'bach', minutes: 35, endedAt: '2026-08-01T10:35:00Z' }],
    }), 'bach');
    expect(result.diagnostics.realMinutes).toBe(35);
    expect(result.diagnostics.timeline.practice[0].kind).toBe('plant');
  });

  it('uses the configured score bands for speed samples', () => {
    const sessions = [
      { id: 'first', items: [item('2026-08-01T10:00:00Z', 10, { solRating: 45 })] },
      { id: 'second', items: [item('2026-08-02T10:00:00Z', 100, { solRating: 55 })] },
    ];
    const result = Readiness.estimateReadiness(dbWith(obra(), sessions), 'bach');
    expect(result.diagnostics.speed.source).toBe('global');
    expect(result.diagnostics.speed.value).toBe(10);
  });

  it('uses event completion dates and deduplicates their mirrored sol history', () => {
    const result = Readiness.estimateReadiness(dbWith(obra({ solHistory: [
      { val: 90, date: '2026-08-20', context: 'pase-escena' },
    ] }), [], {
      eventos: [{ id: 'concert', fecha: '2026-08-01', completedDate: '2026-08-20', resultado: { obrasResultados: [{ obraId: 'bach', sol: 90 }] } }],
    }), 'bach');
    expect(result.evidenceCount).toBe(1);
    expect(result.diagnostics.deduplicatedEvidence).toBe(1);
    expect(result.diagnostics.timeline.checkpoints[0].kind).toBe('event');
    expect(result.diagnostics.timeline.checkpoints[0].date.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('does not derive retention or speed intervals across movement targets', () => {
    const movements = [
      { id: 'one', solHistory: [{ val: 40, date: '2026-08-01' }] },
      { id: 'two', solHistory: [{ val: 70, date: '2026-08-15' }] },
    ];
    const result = Readiness.estimateReadiness(dbWith(obra({ movimientos: movements }), [
      { items: [item('2026-08-10T10:00:00Z', 100)] },
    ]), 'bach');
    expect(result.diagnostics.retention.pairs).toBe(0);
    expect(result.diagnostics.speed.source).toBe('fallback');
  });

  it('reads movement-owned histories and clears a covered strong movement weak-link', () => {
    const movements = [
      { id: 'one', compasesTotal: 100, compasActual: 100, solHistory: [{ val: 82, date: '2026-08-01' }] },
      { id: 'two', compasesTotal: 100, compasActual: 100, paseHistory: [{ score: 8, date: '2026-08-02' }] },
    ];
    const result = Readiness.estimateReadiness(dbWith(obra({ sol: 82, compasesTotal: 100, compasActual: 100, movimientos: movements })), 'bach');
    expect(result.diagnostics.timeline.checkpoints.filter(point => point.scope === 'movement')).toHaveLength(2);
    expect(result.diagnostics.movementWeak).toBe(false);
  });

  it('keeps remaining work when formal whole-work evidence masks a weak movement', () => {
    const movements = [
      { id: 'strong', compasesTotal: 100, compasActual: 100, sol: 9 },
      { id: 'weak', compasesTotal: 100, compasActual: 100, sol: 5 },
    ];
    const result = Readiness.estimateReadiness(dbWith(obra({ sol: 90, compasesTotal: 100, compasActual: 100, movimientos: movements }), [], {
      eventos: [{ id: 'concert', date: '2026-08-20', resultado: { obrasResultados: [{ obraId: 'bach', sol: 90 }] } }],
    }), 'bach');
    expect(result.isReady).toBe(false);
    expect(result.pointEstimateMinutes).toBeGreaterThan(0);
    expect(result.factors).toContain('cuello de botella en movimientos');
  });

  it('deduplicates a pass and its generated solHistory point', () => {
    const pass = { id: 'pass-1', solidezPct: 82, date: '2026-08-01', tipo: 'solo' };
    const result = Readiness.estimateReadiness(dbWith(obra({ paseHistory: [pass], solHistory: [{ eventId: 'pass-1', val: 82, date: '2026-08-01' }] })), 'bach');
    expect(result.evidenceCount).toBe(1);
    expect(result.diagnostics.deduplicatedEvidence).toBe(1);
    expect(result.isReady).toBe(false);
  });

  it('keeps distinct id-less session checkpoints while ignoring zero-minute practice rows', () => {
    const sessions = [
      { date: '2026-08-01', items: [item('2026-08-01T10:00:00Z', 0, { solRating: 60 })] },
      { date: '2026-08-08', items: [item('2026-08-08T10:00:00Z', 20, { solRating: 70 })] },
    ];
    const result = Readiness.estimateReadiness(dbWith(obra(), sessions), 'bach');
    expect(result.evidenceCount).toBe(2);
    expect(result.diagnostics.timeline.practice).toHaveLength(1);
    expect(result.diagnostics.realMinutes).toBe(20);
  });

  it('marks repeated robust evidence ready and does not mutate db', () => {
    const db = dbWith(obra({ sol: 82, compasActual: 100, compasesTotal: 100, solHistory: [
      { val: 82, date: '2026-07-01' }, { val: 84, date: '2026-07-12' },
    ], paseHistory: [{ solidezPct: 83, date: '2026-07-12', tipo: 'concierto' }] }), [
      { date: '2026-07-01', items: [item('2026-07-01T10:00:00Z', 30)] },
    ]);
    const before = JSON.stringify(db);
    const result = Readiness.estimateReadiness(db, 'bach');
    expect(result.isReady).toBe(true);
    expect(result.pointEstimateMinutes).toBe(0);
    expect(JSON.stringify(db)).toBe(before);
  });
});
