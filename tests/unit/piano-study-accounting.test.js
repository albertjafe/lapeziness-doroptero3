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
  it('recovers pre-existing goals that arrived after an empty wallet was initialized',()=>{
    const db=database(),history=structuredClone({sessionPlants:db.sessionPlants,sesiones:db.sesiones,pianoRewards:db.pianoRewards});
    const original=db.germanStudy.goals;db.germanStudy.goals=[];
    db.germanStudy.effortWallet={version:1,createdAt:'2026-09-18T06:00:00Z',seedGoalIds:[],seedCostPoints:{},redemptions:[]};
    expect(P.ensureEffortWallet(db).seedGoalIds).toEqual([]);
    db.germanStudy.goals=original;
    expect(P.walletSnapshot(db).points).toBe(.27);
    expect(P.ensureEffortWallet(db).seedGoalIds).toEqual(['g']);
    expect(P.walletSnapshot(db).points).toBe(.27);
    expect({sessionPlants:db.sessionPlants,sesiones:db.sesiones,pianoRewards:db.pianoRewards}).toEqual(history);
    const reloaded=JSON.parse(JSON.stringify(db));
    expect(P.walletSnapshot(reloaded).points).toBe(.27);
    reloaded.sessionPlants[0].mins=60;reloaded.sesiones[0].items[0].minutosReales=60;
    reloaded.sesiones[0].items[0].minutosEstudiados=60;
    expect(P.walletSnapshot(reloaded).points).toBe(.11);
  });

  it('never seeds goals created after the wallet or goals already closed at migration',()=>{
    const db=database();
    db.germanStudy.effortWallet={version:1,createdAt:'2026-09-10T06:00:00Z',seedGoalIds:[],seedCostPoints:{},redemptions:[]};
    expect(P.ensureEffortWallet(db).seedGoalIds).toEqual([]);
    db.germanStudy.effortWallet.createdAt='2026-09-18T06:00:00Z';
    db.germanStudy.goals[0].archivedAt='2026-09-17T12:00:00Z';
    expect(P.ensureEffortWallet(db).seedGoalIds).toEqual([]);
    delete db.germanStudy.goals[0].archivedAt;
    db.germanStudy.goals[0].deletedAt='2026-09-17T12:00:00Z';
    expect(P.ensureEffortWallet(db).seedGoalIds).toEqual([]);
    db.germanStudy.goals[0].deletedAt='2026-09-19T12:00:00Z';
    expect(P.ensureEffortWallet(db).seedGoalIds).toEqual(['g']);
  });

  it('preserves opening caps and subtracts purchases once after recovering a seed',()=>{
    const db=database();
    db.germanStudy.effortWallet={version:1,createdAt:'2026-09-18T06:00:00Z',seedGoalIds:[],seedCostPoints:{g:.2},redemptions:[{id:'purchase',points:.1}]};
    expect(P.walletSnapshot(db).points).toBe(.1);
    db.germanStudy.goals[0].amount=300;
    expect(P.walletSnapshot(db).points).toBe(.1);
    expect(db.germanStudy.effortWallet.seedCostPoints.g).toBe(.2);
    expect(db.germanStudy.effortWallet.redemptions).toHaveLength(1);
  });

  it('retains the chamber type from legacy reward evidence when the plant lacks it',()=>{
    const db=database(180);db.sesiones=[];db.sessionPlants[0].runId='r';
    P.record(db.pianoRewards,{id:'r',goalId:'g',startedAt:day+'T10:00:00Z',seconds:10800,policyVersion:4,activityType:'chamber'});
    const state=P.studyState(db,day);
    expect(state.sessions[0]).toMatchObject({seconds:10800,activityType:'chamber',activityFactor:1/3,policyVersion:4});
    expect(P.walletSnapshot(db).points).toBe(.11);
  });

  it('counts two manual hours once and starts the next second in the two-hour tier',()=>{
    const db=database(),before=structuredClone(db),state=P.studyState(db,day);
    expect(live(db)).toMatchObject({seconds:7200,tierStartSeconds:7200,nextSeconds:9000,today:.27});
    const next=P.live(state,db.germanStudy.goals,'g',1,day);
    expect(next.today).toBeCloseTo(P.baseReward(7201,P.POLICIES[5]),6);
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
