import {describe,it,expect,vi} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const D=require('../../daily-study-minutes.js');
const P=require('../../piano-rewards.js');

const previousFind=(records,evidence)=>records.filter(x=>x&&x.id&&!x.deleted&&!x.deletedAt).find(item=>
  evidence?.runId===item.id || String(evidence?.runId||'').startsWith(item.id+'::passage::') || evidence?.id==='run_'+item.id ||
  (evidence?.startedAt&&Date.parse(evidence.startedAt)===Date.parse(item.startedAt)));

describe('indexed canonical study evidence',()=>{
  it('keeps the first matching record across identity, timestamp and passage matches',()=>{
    const records=[
      null,{id:'deleted',deleted:true,startedAt:'2026-09-01T10:00:00Z'},
      {id:'timestamp-first',startedAt:'2026-09-01T10:00:00Z'},
      {id:'run',startedAt:'2026-09-02T10:00:00Z'},
      {id:'run::passage::nested',startedAt:'2026-09-03T10:00:00Z'},
      {id:7,startedAt:'2026-09-04T10:00:00Z'},
      {id:'run',startedAt:'2026-09-05T10:00:00Z'},
    ];
    const find=D.evidenceLookup(records);
    for(const evidence of [undefined,{}, {runId:'run'}, {id:'run_run'},
      {runId:'run',startedAt:'2026-09-01T12:00:00+02:00'},
      {runId:'run::passage::nested::passage::child'}, {runId:7}, {runId:'7'},
      {runId:'7::passage::x'}, {startedAt:'bad'}, {startedAt:'2026-09-05T10:00:00Z'}]) {
      expect(find(evidence)).toBe(previousFind(records,evidence));
    }
  });

  it('matches the old join for generated ambiguous histories without modifying their records',()=>{
    const records=Array.from({length:80},(_,i)=>({id:i%11===0?'duplicate':'r'+i,
      startedAt:new Date(Date.UTC(2026,8,1,i%23)).toISOString(),deleted:i%17===0}));
    const frozen=structuredClone(records),find=D.evidenceLookup(records);
    for(let i=0;i<800;i++) {
      const evidence={runId:(i%3===0?'duplicate':'r'+i%90)+(i%4===0?'::passage::'+i:''),
        id:'run_r'+i%90,startedAt:i%5===0?'bad':new Date(Date.UTC(2026,8,1,i%24)).toISOString()};
      expect(find(evidence)).toBe(previousFind(records,evidence));
    }
    expect(records).toEqual(frozen);
  });

  it('bounds date parsing linearly for a large legacy Forest history and preserves projected minutes',()=>{
    const sessions=Array.from({length:130},(_,i)=>({id:'r'+i,goalId:'g',activityType:'study',seconds:1800,
      date:'2026-09-01',startedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString()}));
    const db={obras:[],sesiones:[],sessionPlants:[],forestPlants:Array.from({length:9000},(_,i)=>({id:'f'+i,
      obraId:'w',mins:1,startedAt:new Date(Date.UTC(2026,8,2,0,i)).toISOString()})),
      germanStudy:{goals:[{id:'g',amount:150,createdAt:'2026-09-01T00:00:00Z'}]},pianoRewards:{sessions}};
    const parse=vi.spyOn(Date,'parse');
    try {
      const state=P.studyState(db,'2026-10-01');
      expect(state.sessions.reduce((n,s)=>n+s.seconds,0)).toBe(9000*60);
      // Includes the reward policy/achievement calculations, not just the join.
      expect(parse.mock.calls.length).toBeLessThan(9000*24);
    } finally {parse.mockRestore();}
  });

  it('parses each join date once rather than once per candidate',()=>{
    const records=Array.from({length:1000},(_,i)=>({id:'r'+i,startedAt:new Date(Date.UTC(2026,8,1,0,i)).toISOString()}));
    const parse=vi.spyOn(Date,'parse');
    try {
      const find=D.evidenceLookup(records);
      for(let i=0;i<500;i++)expect(find({startedAt:'2020-01-01T00:00:00Z'})).toBeUndefined();
      expect(parse.mock.calls.length).toBe(1500);
    } finally {parse.mockRestore();}
  });
});
