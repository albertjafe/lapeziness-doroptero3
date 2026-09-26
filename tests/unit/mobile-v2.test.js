import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const M = require('../../mobile-v2.js');

const data = { obras: [
  { id: 'b', name: 'Partita nº 2', composer: 'Bach', movimientos: [{ id: 'cap', name: 'Capriccio' }, { id: 'sin', name: 'Sinfonia' }] },
  { id: 'c', name: 'Balada nº 1', composer: 'Chopin', movimientos: [] },
] };

describe('plan del Profesor pegado', () => {
  it('reads only the PLAN_PARA_HOY block, in any common duration format', () => {
    const text = 'Aquí tienes tu día.\n\nPLAN_PARA_HOY\n- 45 min | Balada nº 1 | coda en frío\n2. 1 h 15 | Partita nº 2 · Capriccio | fuga lenta | con metrónomo\n30 | Descanso activo\n\nPor qué este orden: ...';
    expect(M.parsePlan(text)).toEqual([
      { minutes: 45, label: 'Balada nº 1', purpose: 'coda en frío' },
      { minutes: 75, label: 'Partita nº 2 · Capriccio', purpose: 'fuga lenta · con metrónomo' },
      { minutes: 30, label: 'Descanso activo', purpose: '' },
    ]);
  });
  it('links each line to the right work or movement by name', () => {
    expect(M.matchUnit('Partita nº 2 · Capriccio', data)).toEqual({ obraId: 'b', movId: 'cap' });
    expect(M.matchUnit('Chopin Balada nº 1', data)).toEqual({ obraId: 'c', movId: null });
    expect(M.matchUnit('Sinfonia', data)).toEqual({ obraId: 'b', movId: 'sin' });
    expect(M.matchUnit('Escalas', data)).toBeNull();
  });
  it('ignores prose lines without the three-part format', () => {
    expect(M.parsePlan('Hoy te recomiendo descansar | no hay número')).toEqual([]);
  });
});

describe('frase del resumen', () => {
  it('says one clear thing instead of three contradictory numbers', () => {
    expect(M.sentence(130, { eta4: { etaMin: 19 * 60 + 20 } })).toMatch(/^Si sigues ahora, llegas a 4 h a las 19:20\.$/);
    expect(M.sentence(0, { eta4: { etaMin: 13 * 60 } })).toMatch(/^Si empiezas ahora/);
    expect(M.sentence(100, { eta4: { none: true } })).toBe('Hoy ya no llegas a 4 h antes de tu hora tope.');
    expect(M.sentence(250, {})).toBe('Ya tienes las 4 h de hoy.');
    expect(M.sentence(305, {})).toBe('Día de 5 horas conseguido.');
  });
});
