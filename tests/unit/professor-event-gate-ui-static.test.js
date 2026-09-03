import { describe, expect, it } from 'vitest';
import fs from 'node:fs';

const source = fs.readFileSync('professor-event-gate-ui.js', 'utf8');

describe('Professor event gate UI safety', () => {
  it('does not observe the whole app or rewrite its own hint on every mutation', () => {
    expect(source).not.toContain('observer.observe(document.body');
    expect(source).toContain('observer.observe(view');
    expect(source).toMatch(/hint\s*&&\s*hint\.textContent\s*!==\s*HINT/);
  });
});
