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
  it('deduplicates repeated timer plants and ignores their crono session mirrors', () => {
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
          { obraId: 'general', _planId: 'crono_general_1', estudiado: true, minutosReales: 26 },
          { obraId: 'beethoven', movId: 'I', _planId: 'crono_beth_I_1', estudiado: true, minutosReales: 40 },
          { obraId: 'beethoven', movId: 'II', _planId: 'crono_beth_II_1', estudiado: true, minutosReales: 25 },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(184);
  });

  it('reproduces Sep 5 exactly: accumulated crono snapshots do not inflate 216 real minutes', () => {
    const db = {
      sessionPlants: [
        { obraId: 'general', mins: 26, startedAt: '2026-09-05T08:42:32.164Z', endedAt: '2026-09-05T09:11:40.344Z', runId: 'r1' },
        { obraId: 'beethoven', movId: 'I', mins: 40, startedAt: '2026-09-05T09:37:13.408Z', endedAt: '2026-09-05T10:17:16.199Z', runId: 'r2' },
        { obraId: 'beethoven', movId: 'II', mins: 25, startedAt: '2026-09-05T10:33:37.636Z', endedAt: '2026-09-05T10:59:21.714Z', runId: 'r3' },
        { obraId: 'brahms', movId: 'III', mins: 47, startedAt: '2026-09-05T11:38:44.553Z', endedAt: '2026-09-05T12:26:13.693Z', runId: 'r4' },
        { obraId: 'brahms', movId: 'I', mins: 35, startedAt: '2026-09-05T14:16:36.483Z', endedAt: '2026-09-05T14:52:24.084Z', runId: 'r5' },
        { obraId: 'brahms', movId: 'IV', mins: 11, startedAt: '2026-09-05T14:53:15.002Z', endedAt: '2026-09-05T15:05:09.401Z', runId: 'r6' },
        { obraId: 'prok', movId: 'I', mins: 10, startedAt: '2026-09-05T15:25:29.953Z', endedAt: '2026-09-05T15:35:50.560Z', runId: 'r7' },
        { obraId: 'prok', movId: 'I', mins: 22, startedAt: '2026-09-05T15:37:04.180Z', endedAt: '2026-09-05T16:04:48.881Z', runId: 'r8' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T09:11:41.445Z',
        items: [
          { obraId: 'general', _planId: 'crono_general_1', estudiado: true, minutosReales: 26 },
          { obraId: 'general', _planId: 'crono_general_1', estudiado: true, minutosReales: 52, startedAt: '2026-09-05T08:42:32.164Z', endedAt: '2026-09-05T09:11:40.344Z' },
          { obraId: 'beethoven', movId: 'I', _planId: 'crono_beth_I_1', estudiado: true, minutosReales: 40 },
          { obraId: 'beethoven', movId: 'I', _planId: 'crono_beth_I_1', estudiado: true, minutosReales: 80, startedAt: '2026-09-05T09:37:13.408Z', endedAt: '2026-09-05T10:17:16.199Z' },
          { obraId: 'beethoven', movId: 'II', _planId: 'crono_beth_II_1', estudiado: true, minutosReales: 25 },
          { obraId: 'brahms', movId: 'I', _planId: 'crono_brahms_I_1', estudiado: true, minutosReales: 35 },
          { obraId: 'brahms', movId: 'IV', _planId: 'crono_brahms_IV_1', estudiado: true, minutosReales: 11 },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.version).toBe(3);
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(216);
  });

  it('adds a genuine manual block that does not overlap timed study', () => {
    const db = {
      sessionPlants: [
        { obraId: 'beethoven', movId: 'II', mins: 25, startedAt: '2026-09-05T10:33:37.636Z', endedAt: '2026-09-05T10:59:21.714Z' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T10:59:30.000Z',
        items: [
          { obraId: 'beethoven', movId: 'II', _planId: 'extra_manual_1', estudiado: true, minutosReales: 20, startedAt: '2026-09-05T11:20:00.000Z', endedAt: '2026-09-05T11:40:00.000Z' },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(45);
  });

  it('does not add an old extra summary when it overlaps the same timed work', () => {
    const db = {
      sessionPlants: [
        { obraId: 'rach', mins: 47, startedAt: '2026-09-05T11:20:55.284Z', endedAt: '2026-09-05T12:23:12.206Z' },
        { obraId: 'rach', mins: 16, startedAt: '2026-09-05T12:33:30.696Z', endedAt: '2026-09-05T12:50:22.918Z' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T12:50:30.000Z',
        items: [
          { obraId: 'rach', _planId: 'extra_rach_1', estudiado: true, minutosReales: 78, startedAt: '2026-09-05T11:20:33.766Z', endedAt: '2026-09-05T12:50:22.918Z' },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(63);
  });

  it('uses session history as fallback when timed plants do not exist', () => {
    const db = {
      sessionPlants: [],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T12:00:00.000Z',
        items: [
          { obraId: 'legacy', _planId: 'crono_legacy_1', estudiado: true, minutosReales: 30 },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(30);
  });
});