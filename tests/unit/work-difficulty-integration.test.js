import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../../work-difficulty-integration.js', import.meta.url), 'utf8');

describe('work difficulty premium integration', () => {
  it('reuses the canonical difficulty chip instead of searching only by the old label', () => {
    expect(source).toContain("el.classList.contains('obra-difficulty-chip')");
    expect(source).toMatch(/\^\(Dificultad\|Técnica\)/);
  });

  it('removes already accumulated duplicate difficulty chips', () => {
    expect(source).toContain("if(el.classList.contains('obra-difficulty-chip')||/^Técnica\\s*·/i.test(text))el.remove();");
  });

  it('does not rewrite the DOM when difficulty content is already current', () => {
    expect(source).toContain('if(chip.innerHTML!==html)chip.innerHTML=html;');
    expect(source).toContain('if(detail.innerHTML!==html)detail.innerHTML=html;');
    expect(source).toContain('if(pill.textContent!==text)pill.textContent=text;');
  });
});
