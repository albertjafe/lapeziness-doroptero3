import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../obras-redesign.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../obras-redesign.css', import.meta.url), 'utf8');
const polish = readFileSync(new URL('../../obras-redesign-polish.js', import.meta.url), 'utf8');
const polishCss = readFileSync(new URL('../../obras-redesign-polish.css', import.meta.url), 'utf8');
const premiumPolish = readFileSync(new URL('../../obra-premium-polish.js', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../../piano-rooms.js', import.meta.url), 'utf8');

describe('repertorio redesign', () => {
  it('compiles the redesign and its behavior layers as browser JavaScript', () => {
    expect(() => new vm.Script(source)).not.toThrow();
    expect(() => new vm.Script(polish)).not.toThrow();
    expect(() => new vm.Script(premiumPolish)).not.toThrow();
  });

  it('keeps a legacy escape hatch and the three repertoire scopes', () => {
    expect(source).toContain('Vista clásica / herramientas');
    expect(source).toContain("data-scope=\"all\"");
    expect(source).toContain("data-scope=\"active\"");
    expect(source).toContain("data-scope=\"history\"");
    expect(source).toContain('legacyRenderObras');
  });

  it('implements the iPad master-detail composition and loads after the premium sheet', () => {
    expect(css).toContain('grid-template-columns:minmax(330px,.72fr) minmax(500px,1.28fr)');
    expect(polishCss).toContain('#view-obras.obras-master-detail .obras-rd-layout');
    expect(polish).toContain('window.innerWidth > window.innerHeight');
    expect(bootstrap.indexOf('obraPremiumScript')).toBeLessThan(bootstrap.indexOf('obraPremiumPolishScript'));
    expect(bootstrap.indexOf('obraPremiumPolishScript')).toBeLessThan(bootstrap.indexOf('obrasRedesignScript'));
    expect(bootstrap.indexOf('obrasRedesignScript')).toBeLessThan(bootstrap.indexOf('obrasRedesignPolishScript'));
  });
});
