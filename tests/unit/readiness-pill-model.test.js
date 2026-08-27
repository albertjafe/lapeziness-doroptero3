import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const BaseReadiness = require('../../readiness-core.js');
const Solidity = require('../../solidity-model.js');
const patchSource = readFileSync(new URL('../../readiness-pill-model.js', import.meta.url), 'utf8');

function patchedCore() {
  const core = { ...BaseReadiness };
  const context = {
    window: {
      ReadinessCore: core,
      SolidityModel: Solidity,
      renderObras: null,
      updateCronoReadiness: null,
      dispatchEvent() {},
    },
    CustomEvent: class CustomEvent { constructor(type) { this.type = type; } },
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
    console,
  };
  vm.runInNewContext(patchSource, context);
  return context.window.ReadinessCore;
}

const work = extra => ({ id: 'w', name: 'Work', tipo: 'obra', sol: 1, ...extra });
const session = (date, minutes) => ({
  id: `s-${date}`,
  date: date.slice(0, 10),
  items: [{ obraId: 'w', minutosReales: minutes, endedAt: date }],
});

describe('single-pill readiness patch', () => {
  it('keeps 1% as 1%, rather than legacy-converting it to 10%', () => {
    const Ready = patchedCore();
    const result = Ready.estimateReadiness({ obras: [work({ sol: 1 })], sesiones: [] }, 'w');
    expect(result.rawScore).toBe(1);
    expect(result.effectiveScore).toBe(1);
    expect(result.diagnostics.singlePillModel).toBe(true);
  });

  it('never lets previous mastery raise current solidity', () => {
    const Ready = patchedCore();
    const current = work({
      sol: 30,
      historicalSourceId: 'old',
      solHistory: [
        { val: 95, date: '2025-01-01T20:00:00Z' },
        { val: 30, date: '2026-08-20T20:00:00Z' },
      ],
    });
    const db = {
      obras: [current], sesiones: [],
      historicalRepertoire: [{ id: 'old', peakLevel: 95, estimatedHours: 200, lastPlayedYear: 2025 }],
    };
    const recovered = Ready.estimateReadiness(db, 'w', { asOf: '2026-08-27T20:00:00Z' });
    const fresh = Ready.estimateReadiness({ obras: [{ ...current, historicalSourceId: null }], sesiones: [] }, 'w', { asOf: '2026-08-27T20:00:00Z' });
    expect(recovered.rawScore).toBe(30);
    expect(recovered.effectiveScore).toBe(30);
    expect(recovered.pointEstimateMinutes).toBeLessThan(fresh.pointEstimateMinutes);
  });

  it('does not auto-decay the displayed pill after a long gap', () => {
    const Ready = patchedCore();
    const result = Ready.estimateReadiness({
      obras: [work({ sol: 70, solHistory: [{ val: 70, date: '2026-01-01T20:00:00Z' }] })],
      sesiones: [],
    }, 'w', { asOf: '2026-08-27T20:00:00Z' });
    expect(result.rawScore).toBe(70);
    expect(result.effectiveScore).toBe(70);
    expect(result.diagnostics.retention.pillPenalty).toBe(0);
  });

  it('attributes a late 1→70 jump to the work accumulated across the plateau', () => {
    const Ready = patchedCore();
    const db = {
      obras: [work({
        sol: 70,
        solHistory: [
          { val: 1, date: '2026-01-01T20:00:00Z' },
          { val: 1, date: '2026-01-10T20:00:00Z' },
          { val: 2, date: '2026-01-20T20:00:00Z' },
          { val: 70, date: '2026-01-30T20:00:00Z' },
        ],
      })],
      sesiones: [
        session('2026-01-05T12:00:00Z', 60),
        session('2026-01-12T12:00:00Z', 60),
        session('2026-01-22T12:00:00Z', 60),
        session('2026-01-30T12:00:00Z', 60),
      ],
    };
    const result = Ready.estimateReadiness(db, 'w', { asOf: '2026-01-30T21:00:00Z' });
    const plateau = result.diagnostics.speed.samples.find(sample => sample.same && sample.fromScore <= 2 && sample.toScore === 70);
    expect(plateau).toBeTruthy();
    expect(plateau.minutes).toBe(240);
    expect(plateau.plateauDays).toBeGreaterThan(28);
    expect(result.factors).toContain('progreso medido a través de mesetas');
  });
});
