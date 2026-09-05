import vm from 'node:vm';
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync('daily-study-minutes.js', 'utf8');

function loadFix(db) {
  const context = {
    db,
    window: { db },
    console,
    Date,
    Math,
    Number,
    String,
    Object,
    Set,
    Array,
    setTimeout: () => 0,
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.window.DailyStudyMinutes;
}

function dayRange() {
  return {
    start: new Date(2026, 8, 5, 0, 0, 0, 0),
    end: new Date(2026, 8, 6, 0, 0, 0, 0),
  };
}

describe('daily study minutes', () => {
  it('deduplicates repeated timer plants and does not add the session summary again', () => {
    const plants = [
      { obraId: 'general', mins: 26, startedAt: '2026-09-05T08:42:32.164Z', endedAt: '2026-09-05T09:11:40.344Z' },
      { obraId: 'general', mins: 26, startedAt: '2026-09-05T08:42:32.164Z', endedAt: '2026-09-05T09:11:40.344Z' },
      { obraId: 'beethoven', movId: 'I', mins: 40, startedAt: '2026-09-05T09:37:13.408Z', endedAt: '2026-09-05T10:17:16.199Z' },
      { obraId: 'beethoven', movId: 'I', mins: 40, startedAt: '2026-09-05T09:37:13.408Z', endedAt: '2026-09-05T10:17:16.199Z' },
      { obraId: 'beethoven', movId: 'II', mins: 25, startedAt: '2026-09-05T10:33:37.636Z', endedAt: '2026-09-05T10:59:21.714Z' },
      { obraId: 'brahms', movId: 'III', mins: 47, startedAt: '2026-09-05T11:38:44.553Z', endedAt: '2026-09-05T12:26:13.693Z' },
      { obraId: 'brahms', movId: 'I', mins: 35, startedAt: '2026-09-05T14:16:36.483Z', endedAt: '2026-09-05T14:52:24.084Z' },
      { obraId: 'brahms', movId: 'IV', mins: 11, startedAt: '2026-09-05T14:53:15.002Z', endedAt: '2026-09-05T15:05:09.401Z' },
    ];
    const db = {
      sessionPlants: plants,
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T09:11:41.445Z',
        items: [
          { obraId: 'general', estudiado: true, minutosReales: 26 },
          { obraId: 'beethoven', movId: 'I', estudiado: true, minutosReales: 40 },
          { obraId: 'beethoven', movId: 'II', estudiado: true, minutosReales: 25 },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(184);
  });

  it('preserves legitimate manual extra time by taking the larger per target total', () => {
    const db = {
      sessionPlants: [
        { obraId: 'beethoven', movId: 'II', mins: 25, startedAt: '2026-09-05T10:33:37.636Z', endedAt: '2026-09-05T10:59:21.714Z' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T10:59:30.000Z',
        items: [{ obraId: 'beethoven', movId: 'II', estudiado: true, minutosReales: 45 }],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(45);
  });
});