const { describe, it, expect } = require('vitest');
const model = require('../../work-difficulty-model.js');

describe('WorkDifficultyModel', () => {
  it('uses a nonlinear load scale', () => {
    expect(model.loadFor(1)).toBeCloseTo(1, 6);
    expect(model.loadFor(3)).toBeCloseTo(2, 6);
    expect(model.loadFor(5)).toBeCloseTo(4, 6);
    expect(model.loadFor(7)).toBeCloseTo(8, 6);
    expect(model.loadFor(9)).toBeCloseTo(16, 6);
    expect(model.loadFor(10)).toBeCloseTo(22.627, 3);
  });

  it('rates Waldstein and its movements from the curated catalog', () => {
    const work = {
      composer: 'Beethoven',
      name: 'Sonata para piano n.º 21 en do mayor, Op. 53 «Waldstein»',
      movimientos: [{ duracion: 11 }, { duracion: 4 }, { duracion: 10 }],
    };
    const result = model.resolve(work);
    expect(result.source).toBe('curated');
    expect(result.score).toBe(8.6);
    expect(model.resolveMovement(work, work.movimientos[0], 0).score).toBe(8.8);
    expect(model.resolveMovement(work, work.movimientos[1], 1).score).toBe(5.0);
    expect(model.resolveMovement(work, work.movimientos[2], 2).score).toBe(8.9);
  });

  it('weights movement difficulty in load space, not by arithmetic average', () => {
    const score = model.aggregateMovements([
      { score: 5, duration: 10 },
      { score: 9, duration: 2 },
    ]);
    expect(score).toBeGreaterThan(7);
    expect(score).toBeLessThan(9.1);
  });

  it('keeps a manual difficulty as the authority', () => {
    const result = model.resolve({
      composer: 'Beethoven',
      name: 'Waldstein Op. 53',
      dificultad: 7.4,
      dificultadFuente: 'manual',
    });
    expect(result.score).toBe(7.4);
    expect(result.source).toBe('manual');
    expect(result.confidence).toBe('high');
  });

  it('recognizes extreme repertoire without turning every hard work into 10', () => {
    expect(model.resolve({ composer: 'Ligeti', name: 'Étude n.º 7 «Galamb borong»' }).score).toBe(9.4);
    expect(model.resolve({ composer: 'Rachmaninov', name: 'Concierto para piano n.º 3, Op. 30' }).score).toBe(9.7);
    expect(model.resolve({ composer: 'Prokofiev', name: 'Sonata para piano n.º 7, Op. 83' }).score).toBe(8.9);
  });

  it('provides family estimates for catalog works without exact curation', () => {
    const result = model.resolve({ composer: 'Ludwig van Beethoven', name: 'Piano Sonata No. 29', catalog: 'Op. 106' });
    expect(result.score).toBe(9.8);
    expect(result.source).toBe('catalog-rule');
    expect(result.confidence).toBe('medium');
  });
});
