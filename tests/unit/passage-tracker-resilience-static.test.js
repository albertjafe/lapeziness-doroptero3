import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync('passage-tracker-resilience.js', 'utf8');
const loader = fs.readFileSync('piano-rooms.js', 'utf8');

describe('passage tracker close resilience', () => {
  it('loads after timer save resilience and is shipped as v353', () => {
    const savePos = loader.indexOf("crono-save-resilience.js?v=347");
    const passagePos = loader.indexOf("passage-tracker-resilience.js?v=353");
    expect(savePos).toBeGreaterThan(-1);
    expect(passagePos).toBeGreaterThan(savePos);
  });

  it('stops an active passage before delegating master finish', () => {
    const finishStart = source.indexOf('function installFinishHook()');
    const finishEnd = source.indexOf('function installHechoHook()');
    const block = source.slice(finishStart, finishEnd);
    expect(block.indexOf('stopActivePassage();')).toBeGreaterThan(-1);
    expect(block.indexOf('current.apply(this, arguments)')).toBeGreaterThan(block.indexOf('stopActivePassage();'));
    expect(block).toContain('scheduleSummary()');
  });

  it('commits passage observations when Hecho is saved and self-heals hooks', () => {
    expect(source).toMatch(/if \(shouldSave\)[\s\S]*commitDraft\(\)/);
    expect(source).toMatch(/function monitor\(\)[\s\S]*installFinishHook\(\)[\s\S]*installHechoHook\(\)/);
    expect(source).toContain("state !== 'running' && activeTimerButton()");
  });

  it('renders passage time as included, never additive to master study time', () => {
    expect(source).toContain('El tiempo del pasaje está incluido dentro del cronómetro maestro; no se suma dos veces.');
  });
});
