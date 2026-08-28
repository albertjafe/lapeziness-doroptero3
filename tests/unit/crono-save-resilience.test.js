import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const rescue = readFileSync(new URL('../../crono-save-resilience.js', import.meta.url), 'utf8');
const headerJs = readFileSync(new URL('../../crono-running-premium.js', import.meta.url), 'utf8');
const headerCss = readFileSync(new URL('../../crono-running-premium.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../../piano-rooms.js', import.meta.url), 'utf8');

describe('cronometro resilient save and readable header', () => {
  it('compiles the new browser layers', () => {
    expect(() => new vm.Script(rescue)).not.toThrow();
    expect(() => new vm.Script(headerJs)).not.toThrow();
  });

  it('keeps the Hecho flow alive when local persistence fails', () => {
    expect(rescue).toContain('persisted:true,degradedPersistence:true');
    expect(rescue).toContain('rescuePut(entry)');
    expect(rescue).toContain('protectCloud');
    expect(rescue).toContain("piano_timer_rescue_v1");
  });

  it('moves readiness out of absolute positioning and gives it a readable pill', () => {
    expect(headerCss).toContain('position:static !important');
    expect(headerCss).toContain('#cronoRunReadiness');
    expect(headerCss).toContain('font-size:9.5px !important');
    expect(headerCss).toContain("#cronoRunMovementTotal::before { content:'Mov.'; }");
  });

  it('loads resilience before the rest of the timer presentation addons', () => {
    expect(bootstrap).toContain('cronoSaveResilienceScript');
    expect(bootstrap).toContain('cronoRunningPremiumScript');
    expect(bootstrap.indexOf('cronoSaveResilienceScript')).toBeLessThan(bootstrap.indexOf('cronoRunningPremiumScript'));
  });
});
