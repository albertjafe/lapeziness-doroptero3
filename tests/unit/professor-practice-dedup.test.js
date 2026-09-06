import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const Professor = require('../../professor-core.js');
const Dedup = require('../../professor-practice-dedup.js');

Dedup.install(Professor);

const asOf = new Date('2026-09-06T19:05:00+02:00');

function work(id, name) {
  return { id, name, composer: 'Test', tipo: 'obra', dificultad: 5, minutosExtra: 0, movimientos: [] };
}

describe('Professor practice de-duplication', () => {
  it('does not count repeated session summaries with the same timer plan twice', () => {
    const db = {
      obras: [work('prok-etude', 'Étude')],
      eventos: [],
      sessionPlants: [
        {
          id: 'run-1',
          runId: 'run-1',
          obraId: 'prok-etude',
          mins: 55,
          startedAt: '2026-09-06T09:00:00+02:00',
          endedAt: '2026-09-06T09:55:00+02:00',
        },
      ],
      sesiones: [
        {
          date: '2026-09-06T09:55:00+02:00',
          items: [
            {
              _planId: 'crono_prok-etude_1',
              obraId: 'prok-etude',
              estudiado: true,
              minutosReales: 55,
              startedAt: '2026-09-06T09:00:00+02:00',
              endedAt: '2026-09-06T09:55:00+02:00',
            },
            {
              _planId: 'crono_prok-etude_1',
              obraId: 'prok-etude',
              estudiado: true,
              minutosReales: 55,
            },
          ],
        },
      ],
    };

    const report = Professor.buildReport(db, { asOf, googleCalendarState: {} });
    expect(report.today.totalKnownMinutes).toBe(55);
    expect(report.today.byUnit).toEqual([
      expect.objectContaining({ key: 'prok-etude', minutes: 55 }),
    ]);
    // El informe sigue conservando el historial fuente original para depuración.
    expect(report.sourceContext.sesiones[0].items).toHaveLength(2);
  });

  it('does not revive the original General total after allocating part of it to a passage', () => {
    const db = {
      obras: [work('general', 'General'), work('prok7', 'Sonata 7')],
      eventos: [],
      sessionPlants: [
        {
          id: 'general-parent',
          runId: 'general-run',
          obraId: 'general',
          mins: 12,
          startedAt: '2026-09-06T08:12:00+02:00',
          endedAt: '2026-09-06T08:41:00+02:00',
          passageAllocation: {
            version: 1,
            source: 'passage-general-v1',
            originalMins: 29,
            allocatedMins: 17,
            residualMins: 12,
            children: ['general-run::passage::1'],
          },
        },
        {
          id: 'general-parent__passage_1',
          runId: 'general-run::passage::1',
          obraId: 'prok7',
          mins: 17,
          startedAt: '2026-09-06T08:24:00+02:00',
          endedAt: '2026-09-06T08:41:00+02:00',
          passageAllocationParentKey: 'general-parent',
          passageAllocationSource: 'passage-general-v1',
        },
      ],
      sesiones: [
        {
          date: '2026-09-06T08:41:00+02:00',
          items: [
            {
              _planId: 'crono_general_1',
              obraId: 'general',
              estudiado: true,
              minutosReales: 29,
              startedAt: '2026-09-06T08:12:00+02:00',
              endedAt: '2026-09-06T08:41:00+02:00',
            },
          ],
        },
      ],
    };

    const report = Professor.buildReport(db, { asOf, googleCalendarState: {} });
    expect(report.today.totalKnownMinutes).toBe(29);
    expect(report.recentStudyDays[0].totalMinutes).toBe(29);
    expect(report.recentStudyDays[0].byUnit).toEqual(expect.arrayContaining([
      expect.objectContaining({ obraId: 'general', minutes: 12 }),
      expect.objectContaining({ obraId: 'prok7', minutes: 17 }),
    ]));
  });

  it('keeps an allocation parent as timer evidence even when its residual is zero', () => {
    const db = {
      obras: [work('general', 'General'), work('prok7', 'Sonata 7')],
      eventos: [],
      sessionPlants: [
        {
          id: 'general-parent-zero',
          runId: 'general-run-zero',
          obraId: 'general',
          mins: 0,
          startedAt: '2026-09-06T08:00:00+02:00',
          endedAt: '2026-09-06T08:17:00+02:00',
          passageAllocation: {
            version: 1,
            source: 'passage-general-v1',
            originalMins: 17,
            allocatedMins: 17,
            residualMins: 0,
            children: ['general-run-zero::passage::1'],
          },
        },
        {
          id: 'general-parent-zero__passage_1',
          runId: 'general-run-zero::passage::1',
          obraId: 'prok7',
          mins: 17,
          startedAt: '2026-09-06T08:00:00+02:00',
          endedAt: '2026-09-06T08:17:00+02:00',
          passageAllocationParentKey: 'general-parent-zero',
          passageAllocationSource: 'passage-general-v1',
        },
      ],
      sesiones: [
        {
          date: '2026-09-06T08:17:00+02:00',
          items: [
            {
              _planId: 'crono_general_zero',
              obraId: 'general',
              estudiado: true,
              minutosReales: 17,
              startedAt: '2026-09-06T08:00:00+02:00',
              endedAt: '2026-09-06T08:17:00+02:00',
            },
          ],
        },
      ],
    };

    const report = Professor.buildReport(db, { asOf, googleCalendarState: {} });
    expect(report.today.totalKnownMinutes).toBe(17);
    expect(report.recentStudyDays[0].byUnit).toEqual([
      expect.objectContaining({ obraId: 'prok7', minutes: 17 }),
    ]);
  });
});
