import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const BaseReadiness = require('../../readiness-core.js');
const Solidity = require('../../solidity-model.js');
const pillSource = readFileSync(new URL('../../readiness-pill-model.js', import.meta.url), 'utf8');
const recoverySource = readFileSync(new URL('../../readiness-recovery-context.js', import.meta.url), 'utf8');

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
  vm.runInNewContext(pillSource, context);
  vm.runInNewContext(recoverySource, context);
  return context.window.ReadinessCore;
}

function beethoven(origin = 'recuperacion') {
  return {
    id: 'w',
    name: 'Sonata para violonchelo n.º 3 en la mayor, Op. 69',
    composer: 'Beethoven',
    tipo: 'obra',
    sol: 1,
    origen: origin,
    movimientos: [
      { id: 'm1', name: 'I.', duracion: 8, sol: 3, solHistory: [{ val: 30, date: '2026-08-27T16:21:49Z' }], paseHistory: [] },
      { id: 'm2', name: 'II.', duracion: 5, sol: 1, solHistory: [], paseHistory: [] },
      { id: 'm3', name: 'III.', duracion: 7, sol: 5, solHistory: [{ val: 48, date: '2026-08-27T15:28:33Z' }], paseHistory: [] },
    ],
  };
}

describe('recovery readiness context', () => {
  it('uses today's movement pills for the work instead of the stale whole-work 1%', () => {
    const Ready = patchedCore();
    const work = beethoven();
    const result = Ready.estimateReadiness({ obras: [work], sesiones: [] }, 'w', { asOf: '2026-08-27T20:00:00Z' });
    expect(result.rawScore).toBe(38);
    expect(result.effectiveScore).toBe(38);
    expect(result.diagnostics.derivedWorkScore.source).toBe('movements');
    expect(result.diagnostics.derivedWorkScore.measuredMovements).toBe(2);
    expect(result.diagnostics.recoveryContext.originRecovery).toBe(true);
    expect(result.diagnostics.currentLabel).toBe('Recuperación');
  });

  it('uses previous repertoire only to shorten recovery time, never to raise the pill', () => {
    const Ready = patchedCore();
    const recovery = beethoven('recuperacion');
    const fresh = beethoven('nueva');
    const recovered = Ready.estimateReadiness({ obras: [recovery], sesiones: [] }, 'w', { asOf: '2026-08-27T20:00:00Z' });
    const newWork = Ready.estimateReadiness({ obras: [fresh], sesiones: [] }, 'w', { asOf: '2026-08-27T20:00:00Z' });
    expect(recovered.rawScore).toBe(38);
    expect(newWork.rawScore).toBe(38);
    expect(recovered.pointEstimateMinutes).toBeLessThan(newWork.pointEstimateMinutes);
    expect(recovered.factors).toContain('recuperación más rápida por repertorio previo');
  });
});
