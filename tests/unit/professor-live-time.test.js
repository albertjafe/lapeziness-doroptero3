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

  it('treats the selected hours as a reference rather than a fixed ceiling', () => {
    expect(policy).toContain('La referencia no es una obligación ni un techo');
    expect(policy).toContain('No impongas siempre 4 horas');
  });
});
