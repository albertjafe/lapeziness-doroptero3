import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Catalog = require('../../work-catalog.js');
const works = Catalog.getCatalog();

describe('WorkCatalog', () => {
  it('ships a substantial local piano catalogue', () => {
    expect(Catalog.catalogSize).toBeGreaterThan(300);
  });

  it('normalizes accents and common opus/number spellings', () => {
    expect(Catalog.normalizeText('Opus 49 Nº 2')).toBe('op 49 no 2');
    expect(Catalog.normalizeText('Vallée d’Obermann')).toBe('vallee d obermann');
  });

  it('finds Vallée d’Obermann from Spanish wording', () => {
    const result = Catalog.searchWorks(works, 'valle de obermann', 3);
    expect(result[0].title).toBe("Vallée d'Obermann");
  });

  it('finds both Beethoven Op. 49 sonatas from a natural query', () => {
    const result = Catalog.searchWorks(works, 'beethoven sonata 49', 5);
    expect(result.slice(0, 2).map(item => item.catalog)).toEqual(['Op. 49 No. 1', 'Op. 49 No. 2']);
  });

  it('supports work catalogue numbers and composer spelling variants', () => {
    expect(Catalog.searchWorks(works, 'bwv 893', 1)[0].catalog).toBe('BWV 893');
    expect(Catalog.searchWorks(works, 'scarlatti 502', 1)[0].catalog).toBe('K. 502');
    expect(Catalog.searchWorks(works, 'rachmaninov op 16 4', 1)[0].catalog).toBe('Op. 16 No. 4');
  });

  it('formats the selected result with key and catalogue number', () => {
    const item = Catalog.searchWorks(works, 'beethoven op 49 1', 1)[0];
    expect(Catalog.displayTitle(item)).toBe('Piano Sonata No. 19 in G minor, Op. 49 No. 1');
  });
});
