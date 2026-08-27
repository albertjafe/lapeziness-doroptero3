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

  it('keeps the three repertoire scopes but closes visible legacy stage controls', () => {
    expect(source).toContain('data-scope="all"');
    expect(source).toContain('data-scope="active"');
    expect(source).toContain('data-scope="history"');

    // The old renderer remains in the bundle for backwards compatibility, but
    // the polished UI removes every normal entry point that could make
    // learningStage/estado look like a second source of truth.
    expect(polish).toContain('disableLegacyStageEntryPoints');
    expect(polish).toContain('#obrasRdMenu [data-menu="legacy"]');
    expect(polish).toContain('more.hidden = true');
    expect(polish).toContain("view.classList.remove('obras-legacy-mode', 'obras-more-open')");
    expect(premiumPolish).toContain('disableLegacyDetails');
    expect(premiumPolish).toContain('[data-action="advanced"]');
  });

  it('derives visible state from the solidity model rather than stored stages', () => {
    expect(polish).toContain('model.shortLabel(score)');
    expect(polish).toContain('model.label(score)');
    expect(polish).toContain("work.learningStage = ''");
    expect(polish).toContain("work.estado = ''");
    expect(premiumPolish).toContain('model.label(score)');
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
