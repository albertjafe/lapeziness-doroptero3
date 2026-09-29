import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../work-difficulty-integration.js', import.meta.url), 'utf8');

describe('work difficulty integration', () => {
  it('only enriches data: the work sheet reads the model itself', () => {
    expect(source).toContain('enrichAll');
    expect(source).toContain('patchSave');
    expect(source).not.toContain('obraPremiumOverlay');
    expect(source).not.toContain('MutationObserver');
  });
});
