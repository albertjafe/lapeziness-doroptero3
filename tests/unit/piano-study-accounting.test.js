import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('../../piano-rewards.js');
const day='2026-09-16';
const goal={id:'g',name:'E-book',amount:150,createdAt:'2026-09-12T10:00:00Z'};
function database(minutes=120){
  return {germanStudy:{goals:[{...goal}]},pianoRewards:{sessions:[]},forestPlants:[],
    sessionPlants:[{id:'m',obraId:'bach',source:'manual',mins:minutes,startedAt:day+'T10:00:00Z',endedAt:day+'T12:00:00Z'}],
    sesiones:[{date:day+'T12:00:00Z',items:[{id:'m',obraId:'bach',manual:true,tick:'hecho',minutosEstudiados:minutes,minutosReales:minutes}]}]};
}
const live=db=>P.live(P.studyState(db,day),db.germanStudy.goals,'g',0,day);
describe('piano rewards follow canonical study time',()=>{
  it('counts two manual hours once and starts the next second in the two-hour tier',()=>{
    const db=database(),before=structuredClone(db),state=P.studyState(db,day);
    expect(live(db)).toMatchObject({seconds:7200,tierStartSeconds:7200,nextSeconds:9000,today:.27});
    const next=P.live(state,db.germanStudy.goals,'g',1,day);
    expect(next.today).toBeCloseTo(P.baseReward(7201),6);
    expect(next.hourlyRate).toBeCloseTo(.22,6);
    expect(db.germanStudy.effortWallet).toMatchObject({version:1,displayGoalId:'g',seedGoalIds:['g'],redemptions:[]});
    const comparable=structuredClone(db);delete comparable.germanStudy.effortWallet;
    expect(comparable).toEqual(before);
  });
  it('recalculates additions, reductions and deletion without leaving stale credits',()=>{
    const db=database(30);
    expect(live(db).today).toBe(.05);
    db.sessionPlants[0].mins=300;
    Object.assign(db.sesiones[0].items[0],{minutosEstudiados:300,minutosReales:300});
    expect(live(db)).toMatchObject({seconds:18000,today:2.0265,excellentDay:true,excellenceMultiplier:1.05});
    db.sessionPlants[0].mins=60;
    Object.assign(db.sesiones[0].items[0],{minutosEstudiados:60,minutosReales:60});
    expect(live(db)).toMatchObject({seconds:3600,today:.11,excellenceMultiplier:1});
    db.sessionPlants=[];db.sesiones[0].items=[];
    expect(live(db)).toMatchObject({seconds:0,today:0});
  });
  it('corrects timed rewards and removes them when their actual block is deleted',()=>{
    const db=database(30);db.sessionPlants[0].source='app';
    db.sessionPlants[0].runId='r';db.sesiones[0].items[0]={obraId:'bach',_planId:'crono_bach_r',estudiado:true,minutosReales:30};
    P.record(db.pianoRewards,{id:'r',goalId:'g',startedAt:day+'T10:00:00Z',endedAt:day+'T10:30:00Z',seconds:1800});
    const original=structuredClone(db.pianoRewards);
    db.sessionPlants[0].mins=120;
    expect(live(db)).toMatchObject({seconds:7200,today:.27});
    db.sessionPlants[0].mins=15;
    expect(live(db)).toMatchObject({seconds:900,today:.025});
    db.sessionPlants=[];db.sesiones=[];
    expect(live(db)).toMatchObject({seconds:0,today:0});
    expect(db.pianoRewards).toEqual(original);
  });
  it('deduplicates timed plants, summaries and passages while adding genuine manual minutes',()=>{
    const db=database(60);
    const timed={obraId:'bach',runId:'r',mins:60,source:'app',startedAt:day+'T08:00:00Z',endedAt:day+'T09:00:00Z'};
    db.sessionPlants.push(timed,{...timed});
    db.sesiones[0].items.push({obraId:'bach',_planId:'crono_r',estudiado:true,minutosReales:120});
    db.cronoPasajes=[{minutes:100}];
    expect(live(db)).toMatchObject({seconds:7200,today:.27});
  });
  it('does not reward practice predating the first economic objective',()=>{
    const db=database();
    db.sessionPlants.push({...db.sessionPlants[0],id:'old',mins:420,startedAt:'2020-01-01T10:00:00Z'});
    expect(P.studyState(db,day).sessions).toHaveLength(1);
  });
  it('keeps historical policy attribution while applying corrected canonical minutes',()=>{
    const db=database();db.sessionPlants[0].source='app';db.sesiones=[];
    P.record(db.pianoRewards,{id:'r',goalId:'g',startedAt:day+'T10:00:00Z',endedAt:day+'T12:00:00Z',seconds:7200,policyVersion:1});
    expect(P.ledger(P.studyState(db,day).sessions,[goal])[0]).toMatchObject({policyVersion:1,finalReward:.20});
  });
});
