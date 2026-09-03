import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

const policy = fs.readFileSync('professor-duration-policy.js', 'utf8');

describe('Professor live time policy', () => {
  it('rebuilds the report with a fresh clock when the user asks ChatGPT', () => {
    expect(policy).toContain("const now = new Date();");
    expect(policy).toContain("professor.buildReport(data, { asOf: now })");
    expect(policy).toContain('HORA_LOCAL_REAL=');
    expect(policy).toContain('hora aproximada de finalización');
  });

  it('treats four hours as a reference rather than a fixed ceiling', () => {
    expect(policy).toMatch(/Cuatro horas son una referencia, no un techo/i);
    expect(policy).toMatch(/recomendar 5, 5 h 30 o 6 horas/i);
  });
});
