import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const DataCore = require('../../data-core.js');

describe('historical events', () => {
  it('keeps the browser addon syntactically valid', () => {
    const source = readFileSync(new URL('../../historical-events.js', import.meta.url), 'utf8');
    expect(() => new vm.Script(source)).not.toThrow();
  });

  it('merges the archive across devices and keeps the newest edit', () => {
    const local = {
      historicalEvents: [
        { id: 'he1', name: 'Recital antiguo', year: 2020, updatedAt: '2026-01-01T00:00:00Z' },
      ],
    };
    const cloud = {
      historicalEvents: [
        { id: 'he1', name: 'Recital corregido', year: 2020, updatedAt: '2026-02-01T00:00:00Z' },
        { id: 'he2', name: 'Concurso', year: 2021, updatedAt: '2026-02-02T00:00:00Z' },
      ],
    };
    const merged = DataCore.mergeStudyHistory(local, cloud);
    expect(merged.historicalEvents).toHaveLength(2);
    expect(merged.historicalEvents.find(event => event.id === 'he1').name).toBe('Recital corregido');
    expect(merged.eventos).toBeUndefined();
  });
});
