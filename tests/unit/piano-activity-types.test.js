import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const P=require('../../piano-rewards.js');
const goal={id:'g',name:'Objetivo',amount:150,createdAt:'2026-09-01T10:00:00Z'};
const session=(id,seconds,type='study',startedAt='2026-09-16T10:00:00Z')=>({
  id,goalId:'g',startedAt,endedAt:startedAt,date:startedAt.slice(0,10),seconds,
  activityType:type,activityFactor:P.ACTIVITY_TYPES[type].factor,policyVersion:4
});

describe('piano activity types',()=>{
  it('defines study, mental study, piano class and chamber with their reward factors',()=>{
    expect(P.ACTIVITY_TYPES.study.factor).toBe(1);
    expect(P.ACTIVITY_TYPES.mental.factor).toBe(1);
    expect(P.ACTIVITY_TYPES.piano_class.factor).toBe(.5);
    expect(P.ACTIVITY_TYPES.chamber.factor).toBe(.5);
  });

  it('counts six real hours of piano class as three equivalent hours exactly once',()=>{
    const row=P.ledger([session('class-6h',6*3600,'piano_class')],[goal])[0];
    expect(row.rawDuration).toBe(6*3600);
    expect(row.duration).toBe(3*3600);
    expect(row.activityType).toBe('piano_class');
    expect(row.activityFactor).toBe(.5);
    expect(row.fullDay).toBe(false);
    expect(row.finalReward).toBeCloseTo(P.baseReward(3*3600,P.POLICIES[4]),6);
  });

  it('counts three real hours of chamber as one and a half equivalent hours',()=>{
    const row=P.ledger([session('chamber-3h',3*3600,'chamber')],[goal])[0];
    expect(row.rawDuration).toBe(3*3600);
    expect(row.duration).toBeCloseTo(5400,8);
    expect(row.finalReward).toBeCloseTo(P.baseReward(5400,P.POLICIES[4]),6);
  });

  it('combines one solo hour and six class hours into a four-hour full day',()=>{
    const rows=P.ledger([
      session('solo',3600,'study','2026-09-16T09:00:00Z'),
      session('class',6*3600,'piano_class','2026-09-16T11:00:00Z')
    ],[goal]);
    expect(P.summarizeDays(rows.map(row=>({
      id:row.sessionId,date:row.date,seconds:row.rawDuration,activityType:row.activityType,activityFactor:row.activityFactor
    })))['2026-09-16']).toBe(4*3600);
    expect(rows.every(row=>row.fullDay)).toBe(true);
    expect(rows.every(row=>!row.excellentDay)).toBe(true);
    expect(rows.reduce((sum,row)=>sum+row.finalReward,0)).toBeCloseTo(P.baseReward(4*3600,P.POLICIES[4]),6);
  });

  it('makes the live taximeter advance at the selected activity factor',()=>{
    const state={sessions:[]};
    const study=P.live(state,[goal],'g',3600,'2026-09-16',[],4,'study');
    const mental=P.live(state,[goal],'g',3600,'2026-09-16',[],4,'mental');
    const pianoClass=P.live(state,[goal],'g',3600,'2026-09-16',[],4,'piano_class');
    const chamber=P.live(state,[goal],'g',3600,'2026-09-16',[],4,'chamber');
    expect(study.seconds).toBe(3600);
    expect(mental.seconds).toBe(3600);
    expect(pianoClass.seconds).toBe(1800);
    expect(chamber.seconds).toBeCloseTo(1800,8);
    expect(mental.today).toBeCloseTo(P.baseReward(3600,P.POLICIES[4]),6);
    expect(pianoClass.today).toBeCloseTo(P.baseReward(1800,P.POLICIES[4]),6);
    expect(chamber.today).toBeCloseTo(P.baseReward(1800,P.POLICIES[4]),6);
  });

  it('reprices legacy chamber rows stored at one third to the new half factor',()=>{
    const legacy={...session('legacy-chamber',3600,'chamber'),activityFactor:1/3};
    expect(P.equivalentSeconds(legacy)).toBe(1800);
    const row=P.ledger([legacy],[goal])[0];
    expect(row.rawDuration).toBe(3600);
    expect(row.duration).toBe(1800);
    expect(row.activityFactor).toBe(.5);
  });

  it('stores mental study as real time and counts it fully toward rewards and streaks',()=>{
    const row=P.ledger([session('mental-2h',2*3600,'mental')],[goal])[0];
    expect(row.rawDuration).toBe(2*3600);
    expect(row.duration).toBe(2*3600);
    expect(row.activityType).toBe('mental');
    expect(row.activityFactor).toBe(1);
    expect(row.finalReward).toBeCloseTo(P.baseReward(2*3600,P.POLICIES[4]),6);
  });

  it('persists the activity type and factor on the reward session',()=>{
    const state={sessions:[]};
    expect(P.record(state,{
      id:'class-run',goalId:'g',startedAt:'2026-09-16T10:00:00Z',endedAt:'2026-09-16T12:00:00Z',seconds:7200,
      activityType:'piano_class'
    })).toBe(true);
    expect(state.sessions[0]).toMatchObject({activityType:'piano_class',activityFactor:.5,seconds:7200});
    expect(P.equivalentSeconds(state.sessions[0])).toBe(3600);
  });

  it('retains each surviving block type through manual corrections and deletion',()=>{
    const date='2026-09-16',when=date+'T10:00:00Z';
    const db={germanStudy:{goals:[goal]},sesiones:[],forestPlants:[],pianoRewards:{sessions:[]},sessionPlants:[
      {id:'run_class',runId:'class',obraId:'a',mins:120,startedAt:when,endedAt:date+'T12:00:00Z',activityType:'piano_class'},
      {id:'manual',obraId:'b',mins:60,startedAt:date+'T13:00:00Z',source:'manual'}]};
    P.record(db.pianoRewards,{id:'class',goalId:'g',startedAt:when,seconds:7200,activityType:'piano_class'});
    let projected=P.studyState(db,date);
    expect(P.summarizeDays(projected.sessions)[date]).toBe(7200);
    db.sessionPlants[0].mins=240;
    expect(P.summarizeDays(P.studyState(db,date).sessions)[date]).toBe(10800);
    db.sessionPlants.shift();
    projected=P.studyState(db,date);
    expect(projected.sessions).toHaveLength(1);
    expect(projected.sessions[0]).toMatchObject({activityType:'study',seconds:3600});
  });

  it('weights short rescued canonical blocks even without a separate reward record',()=>{
    const date='2026-09-16';
    const block={id:'short',obraId:'a',mins:5,startedAt:date+'T10:00:00Z',activityType:'chamber',rewardGoalId:'g'};
    const db={germanStudy:{goals:[goal]},sessionPlants:[block],forestPlants:[{...block}],sesiones:[],pianoRewards:{sessions:[]}};
    expect(P.summarizeDays(P.studyState(db,date).sessions)[date]).toBe(150);
  });
});
