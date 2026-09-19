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
  it('inherits missing historical activity from the matching run without modifying plants', () => {
    const startedAt='2026-09-05T10:00:00.000Z';
    const plant={id:'run_r',runId:'r',obraId:'bach',mins:90,source:'app',startedAt};
    const db={sessionPlants:[plant,{obraId:'manual',mins:30,source:'manual',startedAt:'2026-09-05T11:00:00.000Z'}],forestPlants:[],sesiones:[],
      pianoRewards:{sessions:[{id:'r',startedAt,activityType:'chamber',activityFactor:1/3}]}};
    const api=loadFix(db),{start,end}=dayRange();
    expect(api.minutesByDay(start,end)['2026-09-05']).toBe(60);
    expect(api.studyBlocks(start,end)[0]).toMatchObject({rawMins:90,mins:30,activityType:'chamber',activityFactor:1/3});
    expect(plant.activityType).toBeUndefined();
    plant.activityType='study';
    expect(api.minutesByDay(start,end)['2026-09-05']).toBe(120);
  });

  it('matches historical class timestamps and excludes deleted or unrelated reward evidence', () => {
    const startedAt='2026-09-05T10:00:00.000Z';
    const db={sessionPlants:[{obraId:'bach',mins:60,startedAt}],forestPlants:[],sesiones:[],
      pianoRewards:{sessions:[{id:'class',startedAt,activityType:'piano_class',activityFactor:.5}]}};
    const api=loadFix(db),{start,end}=dayRange();
    expect(api.minutesByDay(start,end)['2026-09-05']).toBe(30);
    db.pianoRewards.sessions[0].deletedAt='2026-09-06T10:00:00.000Z';
    expect(api.minutesByDay(start,end)['2026-09-05']).toBe(60);
    delete db.pianoRewards.sessions[0].deletedAt;
    db.pianoRewards.sessions[0].startedAt='2026-09-04T10:00:00.000Z';
    expect(api.minutesByDay(start,end)['2026-09-05']).toBe(60);
  });

  it('projects typed blocks as equivalent study while preserving raw duration', () => {
    const db={sessionPlants:[
      {id:'a',runId:'a',obraId:'a',mins:2.1,startedAt:'2026-09-05T10:00:00Z',activityType:'piano_class'},
      {id:'b',runId:'b',obraId:'b',mins:.1,startedAt:'2026-09-05T11:00:00Z',activityType:'chamber'}],sesiones:[],forestPlants:[]};
    db.forestPlants=[{...db.sessionPlants[0]}];
    const before=JSON.stringify(db),api=loadFix(db),{start,end}=dayRange();
    const blocks=api.studyBlocks(start,end,db);
    expect(blocks.reduce((sum,b)=>sum+b.rawMins,0)).toBeCloseTo(2.2,8);
    expect(blocks.reduce((sum,b)=>sum+b.mins,0)).toBeCloseTo(1,8);
    expect(blocks.map(b=>b.activityType)).toEqual(['piano_class','chamber']);
    expect(blocks.map(b=>b.activityFactor)).toEqual([.5,1/3]);
    expect(api.minutesByDay(start,end,db)['2026-09-05']).toBe(1);
    expect(JSON.stringify(db)).toBe(before);
  });

  it('counts mental study at half while preserving its real minutes', () => {
    const db={sessionPlants:[
      {id:'mental',runId:'mental',obraId:'a',mins:60,startedAt:'2026-09-05T10:00:00Z',activityType:'mental'}
    ],sesiones:[],forestPlants:[]};
    const api=loadFix(db),{start,end}=dayRange(),blocks=api.studyBlocks(start,end,db);
    expect(api.ACTIVITY_FACTORS.mental).toBe(.5);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({rawMins:60,mins:30,activityType:'mental',activityFactor:.5});
  });

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

  it('reproduces Sep 5 exactly: accumulated crono snapshots do not inflate 216 study minutes', () => {
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
    expect(api.version).toBe(8);
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(216);
  });

  it('keeps a fully allocated General session at its original total instead of reviving its legacy mirror', () => {
    const db = {
      sessionPlants: [
        {
          obraId: 'general', mins: 0, runId: 'general-run',
          startedAt: '2026-09-05T08:00:00.000Z', endedAt: '2026-09-05T08:03:00.000Z',
          passageAllocation: { source: 'passage-general-v1', originalMins: 3, residualMins: 0, allocatedMins: 3 },
        },
        {
          obraId: 'beethoven', movId: 'I', mins: 1, runId: 'general-run::passage::1',
          startedAt: '2026-09-05T08:00:00.000Z', endedAt: '2026-09-05T08:01:00.000Z',
          passageAllocationParentKey: 'general-run', passageAllocationSource: 'passage-general-v1',
        },
        {
          obraId: 'bach', movId: 'II', mins: 2, runId: 'general-run::passage::2',
          startedAt: '2026-09-05T08:01:00.000Z', endedAt: '2026-09-05T08:03:00.000Z',
          passageAllocationParentKey: 'general-run', passageAllocationSource: 'passage-general-v1',
        },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T08:03:01.000Z',
        items: [{ obraId: 'general', _planId: 'crono_general_run', estudiado: true, minutosReales: 3 }],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.isPassageAllocationParent(db.sessionPlants[0])).toBe(true);
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(3);
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

  it('counts a quick manual registration once when its session item mirrors a manual plant', () => {
    const db = {
      sessionPlants: [
        { obraId: 'bach', mins: 25, source: 'manual', startedAt: '2026-09-05T10:00:00.000Z', endedAt: '2026-09-05T10:25:00.000Z' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T12:00:00.000Z',
        items: [{ obraId: 'bach', manual: true, tick: 'hecho', minutosEstudiados: 25, minutosReales: 25 }],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(25);
  });

  it('counts an edited timed block once when its session mirror has an arbitrary plan id', () => {
    const db = {
      sessionPlants: [
        { obraId: 'bach', mins: 90, source: 'app', startedAt: '2026-09-05T10:00:00.000Z', endedAt: '2026-09-05T11:30:00.000Z' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T11:30:00.000Z',
        items: [{ obraId: 'bach', _planId: 'plan_edit', estudiado: true, minutosReales: 90 }],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(90);
  });

  it('matches repeated manual mirrors one by one and preserves an unmatched legacy entry', () => {
    const db = {
      sessionPlants: [
        { obraId: 'bach', mins: 25, source: 'manual', startedAt: '2026-09-05T10:00:00.000Z', endedAt: '2026-09-05T10:25:00.000Z' },
        { obraId: 'bach', mins: 25, source: 'manual', startedAt: '2026-09-05T11:00:00.000Z', endedAt: '2026-09-05T11:25:00.000Z' },
      ],
      forestPlants: [],
      sesiones: [{
        date: '2026-09-05T12:00:00.000Z',
        items: [
          { obraId: 'bach', manual: true, tick: 'hecho', minutosReales: 25 },
          { obraId: 'bach', manual: true, tick: 'hecho', minutosReales: 25 },
          { obraId: 'bach', manual: true, tick: 'hecho', minutosReales: 25 },
        ],
      }],
    };
    const api = loadFix(db);
    const { start, end } = dayRange();
    expect(api.minutesByDay(start, end)['2026-09-05']).toBe(75);
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
