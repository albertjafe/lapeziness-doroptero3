import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const DataCore = require('../../data-core.js');

describe('historical repertoire sync', () => {
  it('merges entries by id and keeps the newest edit', () => {
    const merged = DataCore.mergeStudyHistory(
      {
        historicalRepertoire: [
          { id: 'hist-a', name: 'Sonata antigua', updatedAt: '2026-08-01T10:00:00Z', estimatedHours: 50 },
        ],
      },
      {
        historicalRepertoire: [
          { id: 'hist-a', name: 'Sonata corregida', updatedAt: '2026-08-02T10:00:00Z', estimatedHours: 80 },
          { id: 'hist-b', name: 'Concierto antiguo', updatedAt: '2026-08-01T11:00:00Z' },
        ],
      }
    );

    expect(merged.historicalRepertoire).toHaveLength(2);
    expect(merged.historicalRepertoire.find(item => item.id === 'hist-a')).toMatchObject({
      name: 'Sonata corregida',
      estimatedHours: 80,
    });
    expect(merged.historicalRepertoire.find(item => item.id === 'hist-b')).toBeTruthy();
  });

  it('does not move estimated historical hours into measured study fields', () => {
    const merged = DataCore.mergeStudyHistory(
      {
        obras: [{ id: 'obra-1', name: 'Actual', minutosExtra: 30 }],
        historicalRepertoire: [{ id: 'hist-a', name: 'Antigua', estimatedHours: 120, includeInStats: false }],
      },
      { obras: [{ id: 'obra-1', name: 'Actual', minutosExtra: 30 }] }
    );

    expect(merged.obras[0].minutosExtra).toBe(30);
    expect(merged.historicalRepertoire[0].estimatedHours).toBe(120);
    expect(merged.historicalRepertoire[0].includeInStats).toBe(false);
  });
});
