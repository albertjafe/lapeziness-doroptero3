import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = fs.readFileSync('professor-report-normalizer.js', 'utf8');

describe('Professor report normalizer', () => {
  it('does not double count whole-work minutes as unallocated movement minutes', () => {
    const originalReport = {
      asOf: '2026-09-02T18:00:00+02:00',
      today: { movementMinutes: 50, unallocatedMinutes: 80, totalKnownMinutes: 130 },
      warnings: ['Hay 80 min de hoy sin movimiento asignado; no se reparten artificialmente entre movimientos.'],
    };
    const context = {
      window: {
        ProfessorCore: {
          buildReport: () => JSON.parse(JSON.stringify(originalReport)),
        },
      },
      Date,
      Number,
      String,
      Math,
      Array,
      Set,
    };
    vm.runInNewContext(source, context);
    const db = {
      obras: [
        { id: 'whole', movimientos: [] },
        { id: 'multi', movimientos: [{ id: 'm1' }] },
      ],
      sessionPlants: [
        { id: 'whole-session', obraId: 'whole', mins: 30, startedAt: '2026-09-02T10:00:00+02:00' },
        { id: 'parent-session', obraId: 'multi', mins: 20, startedAt: '2026-09-02T11:00:00+02:00' },
      ],
    };
    const report = context.window.ProfessorCore.buildReport(db, { asOf: new Date('2026-09-02T18:00:00+02:00') });
    expect(report.today.unallocatedMinutes).toBe(20);
    expect(report.today.totalKnownMinutes).toBe(70);
    expect(report.warnings.join(' ')).toContain('20 min');
    expect(report.warnings.join(' ')).not.toContain('80 min');
  });
});
