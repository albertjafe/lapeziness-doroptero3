import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Solidity = require('../../solidity-model.js');

describe('SolidityModel', () => {
  it('treats the current pill as a real 0-100 percentage', () => {
    expect(Solidity.currentScore({ sol: 1 })).toBe(1);
    expect(Solidity.currentScore({ sol: 3 })).toBe(3);
    expect(Solidity.currentScore({ sol: 70 })).toBe(70);
  });

  it('lets the latest observation beat an old peak', () => {
    const work = {
      sol: 95,
      solHistory: [
        { val: 95, date: '2025-01-01T20:00:00Z' },
        { val: 28, date: '2026-08-20T20:00:00Z' },
      ],
    };
    expect(Solidity.currentScore(work)).toBe(28);
  });

  it('uses a later pass as the same pill observation', () => {
    const work = {
      solHistory: [{ val: 82, date: '2026-08-01T20:00:00Z' }],
      paseHistory: [{ solidezPct: 57, score: 6, date: '2026-08-10T20:00:00Z' }],
    };
    expect(Solidity.currentScore(work)).toBe(57);
  });

  it('understands legacy pass score=1..10 without converting a modern sol=1', () => {
    expect(Solidity.scoreFromObservation({ score: 8, date: '2025-01-01' })).toBe(80);
    expect(Solidity.scoreFromObservation({ score: 8, solidezPct: 76, date: '2026-01-01' })).toBe(76);
    expect(Solidity.scoreFromObservation({ sol: 1 })).toBe(1);
  });

  it('keeps event solidity separate from the aggregate event score', () => {
    expect(Solidity.scoreFromObservation({ sol: 10, obraScore: 92 })).toBe(10);
    expect(Solidity.scoreFromObservation({ sol: 72, obraScore: 80 })).toBe(72);
    expect(Solidity.scoreFromObservation({ obraScore: 10 })).toBe(10);
  });

  it('derives learned/solid/mastered labels instead of storing another state', () => {
    expect(Solidity.shortLabel(10)).toBe('Inicial');
    expect(Solidity.shortLabel(45)).toBe('Aprendida');
    expect(Solidity.shortLabel(70)).toBe('Sólida');
    expect(Solidity.shortLabel(85)).toBe('Segura');
    expect(Solidity.shortLabel(98)).toBe('Dominada');
    expect(Solidity.learned(39)).toBe(false);
    expect(Solidity.learned(40)).toBe(true);
  });

  it('collapses long flat periods into one learning plateau', () => {
    const points = [
      { score: 1, date: '2026-01-01T20:00:00Z', scope: 'whole' },
      { score: 1, date: '2026-01-10T20:00:00Z', scope: 'whole' },
      { score: 2, date: '2026-01-20T20:00:00Z', scope: 'whole' },
      { score: 70, date: '2026-01-30T20:00:00Z', scope: 'whole' },
    ];
    const groups = Solidity.plateauGroups(points);
    expect(groups).toHaveLength(2);
    expect(groups[0].startScore).toBe(1);
    expect(groups[0].points).toHaveLength(3);
    expect(groups[1].startScore).toBe(70);
  });

  it('derives the work pill from measured movements instead of a stale 1% placeholder', () => {
    const work = {
      sol: 1,
      origen: 'recuperacion',
      movimientos: [
        { id: 'm1', duracion: 8, sol: 3, solHistory: [{ val: 30, date: '2026-08-27T16:21:49Z' }] },
        { id: 'm2', duracion: 5, sol: 1, solHistory: [] },
        { id: 'm3', duracion: 7, sol: 5, solHistory: [{ val: 48, date: '2026-08-27T15:28:33Z' }] },
      ],
    };
    const details = Solidity.workScoreDetails(work);
    expect(details.score).toBe(38);
    expect(details.source).toBe('movements');
    expect(details.measuredMovements).toBe(2);
    expect(details.totalMovements).toBe(3);
    expect(details.partial).toBe(true);
  });

  it('lets a newer whole-work observation override older movement observations', () => {
    const work = {
      sol: 72,
      solHistory: [{ val: 72, date: '2026-08-27T18:00:00Z' }],
      movimientos: [
        { id: 'm1', duracion: 10, solHistory: [{ val: 30, date: '2026-08-27T16:00:00Z' }] },
        { id: 'm2', duracion: 10, solHistory: [{ val: 45, date: '2026-08-27T17:00:00Z' }] },
      ],
    };
    expect(Solidity.currentWorkScore(work)).toBe(72);
  });

  it('labels old low-solidity repertoire as recovery rather than learning', () => {
    const work = { id: 'old', name: 'Old work', composer: 'Composer', sol: 1, origen: 'recuperacion', movimientos: [
      { id: 'm1', duracion: 8, solHistory: [{ val: 30, date: '2026-08-27T16:00:00Z' }] },
      { id: 'm2', duracion: 7, solHistory: [{ val: 48, date: '2026-08-27T17:00:00Z' }] },
    ] };
    expect(Solidity.statusLabel({ obras: [work] }, work, { compact: true })).toBe('Recuperación');
  });

  it('remembers a formal performance at learned level without another manual flag', () => {
    const work = { id: 'w', name: 'Work', composer: 'Composer', sol: 25, solHistory: [{ val: 25, date: '2026-08-27T18:00:00Z' }] };
    const db = {
      obras: [work],
      eventos: [{ id: 'e', tipo: 'concierto', completado: true, obras: ['w'], completedDate: '2026-05-01T20:00:00Z', resultado: { obrasResultados: [{ obraId: 'w', sol: 72, obraScore: 80 }] } }],
    };
    const context = Solidity.historyContext(db, work);
    expect(context.priorMastery).toBe(true);
    expect(context.formalEvent).toBe(true);
    expect(Solidity.statusLabel(db, work)).toBe('Recuperación');
  });

  it('does not call a very low scored formal appearance prior mastery on its own', () => {
    const work = { id: 'w', name: 'Work', composer: 'Composer', sol: 25, solHistory: [{ val: 25, date: '2026-08-27T18:00:00Z' }] };
    const db = {
      obras: [work],
      eventos: [{ id: 'e', tipo: 'audicion', completado: true, obras: ['w'], completedDate: '2026-05-01T20:00:00Z', resultado: { obrasResultados: [{ obraId: 'w', sol: 10, obraScore: 10 }] } }],
    };
    const context = Solidity.historyContext(db, work);
    expect(context.priorMastery).toBe(false);
    expect(context.formalEvent).toBe(false);
    expect(Solidity.statusLabel(db, work)).toBe('Tomando forma');
  });

  it('flags an isolated historical solidity spike without changing it', () => {
    const points = [51, 52, 51, 90].map((score, index) => ({
      rowId: `r${index}`,
      score,
      time: Date.UTC(2026, 7, 27 + index),
      scope: 'whole',
    }));
    const flagged = Solidity.detectOutliers(points);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].point.rowId).toBe('r3');
    expect(flagged[0].score).toBe(90);
    expect(Math.round(flagged[0].baseline)).toBe(52);
  });

  it('flags a middle spike when both surrounding readings agree', () => {
    const points = [51, 90, 52].map((score, index) => ({
      rowId: `r${index}`,
      score,
      time: Date.UTC(2026, 7, 27 + index),
      scope: 'whole',
    }));
    const flagged = Solidity.detectOutliers(points);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].point.rowId).toBe('r1');
  });

  it('does not flag gradual improvement as an anomaly', () => {
    const points = [50, 60, 70, 80].map((score, index) => ({
      score,
      time: Date.UTC(2026, 7, 27 + index),
      scope: 'whole',
    }));
    expect(Solidity.detectOutliers(points)).toEqual([]);
  });

  it('never compares one movement against another movement to find anomalies', () => {
    const points = [
      { rowId: 'a1', score: 50, time: 1, scope: 'movement', movementId: 'a' },
      { rowId: 'a2', score: 51, time: 2, scope: 'movement', movementId: 'a' },
      { rowId: 'b1', score: 92, time: 1, scope: 'movement', movementId: 'b' },
      { rowId: 'b2', score: 93, time: 2, scope: 'movement', movementId: 'b' },
    ];
    expect(Solidity.detectOutliers(points)).toEqual([]);
  });

});
