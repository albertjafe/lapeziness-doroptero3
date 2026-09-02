import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const script = fs.readFileSync('scripts/check-e2e-known-baseline.cjs', 'utf8');
const workflow = fs.readFileSync('.github/workflows/quality.yml', 'utf8');

describe('Quality E2E baseline gate', () => {
  it('keeps the known legacy failures explicit instead of ignoring all E2E errors', () => {
    expect(script).toContain('KNOWN_FAILURES');
    expect(script).toContain('Unexpected E2E failures');
    expect(script).toContain('process.exit(1)');
    expect(script).not.toContain('continue-on-error');
  });

  it('routes Quality through the baseline-aware checker', () => {
    expect(workflow).toContain('node scripts/check-e2e-known-baseline.cjs');
    expect(workflow).not.toContain('npm run test:e2e -- --workers=1');
  });
});
