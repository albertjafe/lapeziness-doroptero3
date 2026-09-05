import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const policy = fs.readFileSync('professor-duration-policy.js', 'utf8');
const loader = fs.readFileSync('piano-rooms.js', 'utf8');

describe('Professor duration fallback policy', () => {
  it('keeps professional advice separate from optional preference-based alternatives', () => {
    expect(policy).toContain('Si aun así quieres ampliar');
    expect(policy).toContain('PREFERENCIA_DURACION');
    expect(policy).toContain('preferencia diaria guardada');
    expect(policy).toMatch(/obra \+ movimiento, minutos y propósito/i);
    expect(policy).toMatch(/NO implica que recomiendes esas horas/i);
  });

  it('does not use unrelated repertoire just to fill extra time', () => {
    expect(policy).toMatch(/solo repertorio con evento\/proyecto futuro enlazado/i);
    expect(policy).toMatch(/No introduzcas una obra sin evento solo para rellenar horas/i);
  });

  it('is loaded after the event gate and before the Professor dashboard', () => {
    const gate = loader.indexOf("professorEventGateScript");
    const duration = loader.indexOf("professorDurationPolicyScript");
    const dashboard = loader.indexOf("professorDashboardScript");
    expect(gate).toBeGreaterThan(-1);
    expect(duration).toBeGreaterThan(gate);
    expect(dashboard).toBeGreaterThan(duration);
  });
});
