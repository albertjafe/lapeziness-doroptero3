import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const R=require('../../german-rewards.js');
const P=require('../../piano-rewards.js');
const D=require('../../document-sync-core.js');
const goal=(id='g',amount=150)=>({id,name:'Kindle',amount,createdAt:'2026-09-01T10:00:00Z'});
const piano=(id,seconds,startedAt='2026-09-12T10:00:00Z',goalId='g',policyVersion=4)=>({id,goalId,startedAt,endedAt:startedAt,date:startedAt.slice(0,10),seconds,policyVersion});

describe('piano progressive taximeter',()=>{
  it.each([[0,0],[1800,.115],[3600,.25],[5400,.415],[7200,.60],[9000,.79],[10800,1],[12600,1.24],[14400,1.50],[16200,1.79],[18000,2.10],[19800,2.44],[21600,2.80],[23400,3.19],[25200,3.60],[30000,3.60]])('%s seconds -> %s euros at the reference goal',(seconds,amount)=>{
    expect(P.baseReward(seconds)).toBeCloseTo(amount,8);
  });

  it('increases every half-hour rate in v6 and keeps a hard seven-hour cap',()=>{
    const increments=P.CONFIG.curve.slice(1).map(([,amount],index)=>amount-P.CONFIG.curve[index][1]);
    increments.slice(1).forEach((increment,index)=>expect(increment).toBeGreaterThan(increments[index]));
    expect(P.CONFIG.version).toBe(6);
    expect(P.baseReward(4*3600)).toBe(1.50);
    expect(P.baseReward(8*3600)).toBe(P.baseReward(7*3600));
    expect(3*P.baseReward(7*3600)).toBeLessThan(150);
  });

  it.each([[1,1],[2,1],[3,1.05],[4,1.05],[5,1.10],[6,1.10],[7,1.15],[9,1.15],[10,1.20],[13,1.20],[14,1.25],[99,1.25]])('full-day streak %s has multiplier %s',(days,multiplier)=>{
    expect(P.streakMultiplier(days)).toBe(multiplier);
  });

  it.each([[0,1],[1,1.05],[2,1.08],[3,1.12],[4,1.16],[5,1.20],[6,1.20],[7,1.30],[9,1.30],[10,1.40],[13,1.40],[14,1.50],[99,1.50]])('excellent-day streak %s has multiplier %s',(days,multiplier)=>{
    expect(P.excellenceMultiplier(days)).toBe(multiplier);
  });

  it('uses the existing sublinear goal scale and the first excellent-day bonus for v4',()=>{
    const small=P.ledger([piano('small',25200,'2026-09-12T10:00:00Z','small')],[goal('small',50)]);
    const reference=P.ledger([piano('reference',25200)],[goal()]);
    const large=P.ledger([piano('large',25200,'2026-09-12T10:00:00Z','large')],[goal('large',50000)]);
    expect(small[0].finalReward).toBeCloseTo(5.50*R.goalScale(50)*1.05,6);
    expect(reference[0].finalReward).toBeCloseTo(5.50*1.05,6);
    expect(large[0].finalReward).toBeCloseTo(5.50*R.goalScale(50000)*1.05,6);
  });

  it('shares the daily curve across split sessions and applies the excellent bonus to the whole v4 day',()=>{
    const rows=P.ledger([
      piano('a',3600,'2026-09-12T09:00:00Z'),
      piano('b',10800,'2026-09-12T11:00:00Z'),
      piano('c',10800,'2026-09-12T15:00:00Z')
    ],[goal()]);
    expect(rows.reduce((sum,row)=>sum+row.microEuros,0)).toBe(5775000);
    expect(rows.map(row=>row.finalReward)).toEqual([.1155,.987,4.6725]);
    expect(rows.every(row=>row.excellentDay&&row.excellenceDays===1&&row.excellenceMultiplier===1.05)).toBe(true);
  });

  it('freezes the full-day streak on rest days and resets it on an incomplete study day',()=>{
    const sessions=[
      piano('d1',14400,'2026-09-10T10:00:00Z'),
      piano('d2',14400,'2026-09-12T10:00:00Z')
    ];
    expect(P.streakByDay(sessions)['2026-09-12'].days).toBe(2);
    expect(P.streakStats(sessions,'2026-09-13').current).toBe(2);
    sessions.push(piano('short',3600,'2026-09-13T10:00:00Z'),piano('restart',14400,'2026-09-14T10:00:00Z'));
    expect(P.streakByDay(sessions)['2026-09-13']).toMatchObject({days:0,fullDay:false,multiplier:1});
    expect(P.streakByDay(sessions)['2026-09-14']).toMatchObject({days:1,fullDay:true,multiplier:1});
  });

  it('makes excellent streaks forgiving: rest and 4h days freeze them, sub-4h study resets them',()=>{
    const sessions=[
      piano('e1',18000,'2026-09-08T10:00:00Z'),
      piano('e2',18000,'2026-09-10T10:00:00Z'),
      piano('good',16200,'2026-09-11T10:00:00Z')
    ];
    expect(P.excellenceByDay(sessions)['2026-09-10']).toMatchObject({days:2,multiplier:1.08,excellentDay:true,frozen:false});
    expect(P.excellenceStats(sessions,'2026-09-09').current).toBe(1);
    expect(P.excellenceByDay(sessions)['2026-09-11']).toMatchObject({days:2,multiplier:1.08,excellentDay:false,frozen:true});
    sessions.push(piano('short',10800,'2026-09-12T10:00:00Z'),piano('restart',18000,'2026-09-13T10:00:00Z'));
    expect(P.excellenceByDay(sessions)['2026-09-12']).toMatchObject({days:0,multiplier:1,excellentDay:false,frozen:false});
    expect(P.excellenceByDay(sessions)['2026-09-13']).toMatchObject({days:1,multiplier:1.05,excellentDay:true,frozen:false});
  });

  it('applies the full-day streak multiplier to the whole qualifying four-hour day',()=>{
    const sessions=[
      piano('d1',14400,'2026-09-10T10:00:00Z'),
      piano('d2',14400,'2026-09-11T10:00:00Z'),
      piano('d3a',7200,'2026-09-12T09:00:00Z'),
      piano('d3b',7200,'2026-09-12T12:00:00Z')
    ];
    const rows=P.ledger(sessions,[goal()]),day3=rows.filter(row=>row.date==='2026-09-12');
    expect(day3.every(row=>row.streakDays===3&&row.streakMultiplier===1.05&&row.fullDay)).toBe(true);
    expect(day3.every(row=>row.excellenceMultiplier===1&&!row.excellentDay)).toBe(true);
    expect(day3.reduce((sum,row)=>sum+row.finalReward,0)).toBeCloseTo(1.05*1.05,6);
  });

  it('stacks full-day and excellence multipliers across repeated five-hour days',()=>{
    const sessions=[
      piano('d1',18000,'2026-09-10T10:00:00Z'),
      piano('d2',18000,'2026-09-11T10:00:00Z'),
      piano('d3a',9000,'2026-09-12T09:00:00Z'),
      piano('d3b',9000,'2026-09-12T13:00:00Z')
    ];
    const rows=P.ledger(sessions,[goal()]),day3=rows.filter(row=>row.date==='2026-09-12');
    expect(day3.every(row=>row.streakDays===3&&row.streakMultiplier===1.05)).toBe(true);
    expect(day3.every(row=>row.excellenceDays===3&&row.excellenceMultiplier===1.12&&row.excellentDay)).toBe(true);
    expect(day3.every(row=>row.rewardMultiplier===1.05*1.12)).toBe(true);
    expect(day3.reduce((sum,row)=>sum+row.finalReward,0)).toBeCloseTo(1.93*1.05*1.12,6);
  });

  it('keeps v1-v3 sessions on their historical economics and gives excellence only from v4 onward',()=>{
    const legacy=piano('legacy',25200,'2026-09-12T10:00:00Z','g',1);delete legacy.policyVersion;
    expect(P.ledger([legacy],[goal()])[0].finalReward).toBe(2.60);
    const oldV2=piano('v2',14400,'2026-09-13T10:00:00Z','g',2);
    const oldV3=piano('v3',25200,'2026-09-14T10:00:00Z','g',3);
    const rows=P.ledger([piano('prior',14400,'2026-09-12T10:00:00Z','g',3),oldV2,oldV3],[goal()]);
    expect(rows.find(item=>item.sessionId==='v2').finalReward).toBe(.75);
    expect(rows.find(item=>item.sessionId==='v2').streakMultiplier).toBe(1);
    expect(rows.find(item=>item.sessionId==='v3').excellenceMultiplier).toBe(1);
  });

  it('records a finished stopwatch run only once under policy v5',()=>{
    const state={sessions:[]};
    expect(P.record(state,{id:'short',goalId:'g',startedAt:'2026-09-12T09:00:00Z',endedAt:'2026-09-12T09:09:59Z',seconds:599})).toBe(false);
    const input={id:'run-1',goalId:'g',startedAt:'2026-09-12T10:00:00Z',endedAt:'2026-09-12T10:30:00Z',seconds:1800};
    expect(P.record(state,input)).toBe(true);
    expect(P.record(state,input)).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({id:'run-1',goalId:'g',date:'2026-09-12',seconds:1800,policyVersion:5});
  });

  it('keeps independently finished piano runs after an offline document merge',()=>{
    const left={pianoRewards:{version:1,sessions:[piano('left',1800,'2026-09-12T09:00:00Z')]}};
    const right={pianoRewards:{version:1,sessions:[piano('right',1800,'2026-09-12T10:00:00Z')]}};
    expect(D.mergeRemote(left,right).pianoRewards.sessions.map(item=>item.id).sort()).toEqual(['left','right']);
  });

  it('combines German and piano chronologically and never exceeds the legacy target',()=>{
    const g=goal('g',1);
    const german=[{id:'de',date:'2026-09-12',startedAt:'2026-09-12T09:00:00Z',goalId:'g',source:'german',duration:900,qualified:true,potentialMicroEuros:700000,microEuros:700000,finalReward:.7}];
    const pianoRows=P.ledger([piano('pi',21600,'2026-09-12T10:00:00Z')],[g]);
    const rows=P.combinedLedger(german,pianoRows,[g]);
    expect(rows.reduce((sum,row)=>sum+row.finalReward,0)).toBe(1);
    expect(rows[1].finalReward).toBe(.3);
  });

  it('shows a second-by-second live increment with the shared wallet',()=>{
    const state={sessions:[piano('saved',3600)]};
    state.effortWallet={version:1,seedGoalIds:['g'],seedCostPoints:{g:150},displayGoalId:'g',redemptions:[]};
    const goals=[goal()];
    const one=P.live(state,goals,'g',1,'2026-09-12',[]);
    const two=P.live(state,goals,'g',2,'2026-09-12',[]);
    expect(two.today).toBeGreaterThan(one.today);
    expect(two.increment).toBeGreaterThan(one.increment);
    expect(two.goalRemaining).toBeGreaterThanOrEqual(0);
  });

  it('upgrades the whole live day when the third full day crosses four hours',()=>{
    const state={sessions:[
      piano('d1',14400,'2026-09-10T10:00:00Z'),
      piano('d2',14400,'2026-09-11T10:00:00Z'),
      piano('today',12600,'2026-09-12T09:00:00Z')
    ],effortWallet:{version:1,seedGoalIds:['g'],seedCostPoints:{g:150},displayGoalId:'g',redemptions:[]}},goals=[goal()];
    const live=P.live(state,goals,'g',1800,'2026-09-12');
    expect(live).toMatchObject({fullDay:true,streakDays:3,streakMultiplier:1.05,excellentDay:false,excellenceMultiplier:1});
    expect(live.today).toBeCloseTo(1.1025,6);
    expect(live.increment).toBeCloseTo(.3525,6);
  });

  it('upgrades the whole live v5 day when a preserved excellence streak crosses five hours',()=>{
    const state={sessions:[
      piano('d1',18000,'2026-09-10T10:00:00Z'),
      piano('d2',18000,'2026-09-11T10:00:00Z'),
      piano('today',16200,'2026-09-12T09:00:00Z')
    ],effortWallet:{version:1,seedGoalIds:['g'],seedCostPoints:{g:150},displayGoalId:'g',redemptions:[]}},goals=[goal()];
    const live=P.live(state,goals,'g',1800,'2026-09-12',[],5);
    expect(live).toMatchObject({fullDay:true,streakDays:3,streakMultiplier:1.05,excellentDay:true,excellenceDays:3,excellenceMultiplier:1.12});
    expect(live.rewardMultiplier).toBeCloseTo(1.176,8);
    expect(live.today).toBeCloseTo(1.93*1.05*1.12,6);
  });

  it('uses one canonical equivalent-study clock for study, piano class and chamber',()=>{
    const sessions=[
      {...piano('solo',3*3600),activityType:'study',activityFactor:1},
      {...piano('class',2*3600),activityType:'piano_class',activityFactor:.5}
    ];
    expect(P.summarizeDays(sessions)['2026-09-12']).toBe(4*3600);
    expect(P.streakByDay(sessions)['2026-09-12'].fullDay).toBe(true);
    const chamber={...piano('chamber',3*3600,'2026-09-13T10:00:00Z'),activityType:'chamber',activityFactor:.5};
    expect(P.equivalentSeconds(chamber)).toBeCloseTo(5400,8);
  });

  it('projects the same shared effort into different euro balances for simultaneous goals',()=>{
    const cheap=goal('cheap',150),expensive=goal('expensive',600);
    const rows=P.ledger([{...piano('shared',4*3600,'2026-09-12T10:00:00Z','cheap',5),activityType:'study'}],[cheap,expensive]);
    const wallet={version:1,seedGoalIds:[],seedCostPoints:{},displayGoalId:'cheap',redemptions:[]};
    const cheapProgress=P.goalProgressFromWallet(cheap,rows,wallet);
    const expensiveProgress=P.goalProgressFromWallet(expensive,rows,wallet);
    expect(cheapProgress.points).toBeCloseTo(expensiveProgress.points,8);
    expect(expensiveProgress.amount).toBeGreaterThan(cheapProgress.amount);
    expect(expensiveProgress.scale).toBeGreaterThan(cheapProgress.scale);
  });

  it('redeeming one goal spends shared effort instead of duplicating it across purchases',()=>{
    const cheap=goal('cheap',1),other=goal('other',150);
    const db={
      germanStudy:{goals:[cheap,other],sessions:[],effortWallet:{version:1,createdAt:'2026-09-12T00:00:00Z',seedGoalIds:[],seedCostPoints:{},displayGoalId:'cheap',redemptions:[]}},
      pianoRewards:{version:1,sessions:[{...piano('earned',7*3600,'2026-09-12T10:00:00Z','cheap',5),activityType:'study'}]}
    };
    const before=P.goalProgressForDb(db,'other');
    const result=P.redeemGoal(db,'cheap',new Date('2026-09-13T12:00:00Z'));
    const after=P.goalProgressForDb(db,'other');
    expect(result.ok).toBe(true);
    expect(after.points).toBeLessThan(before.points);
    expect(after.amount).toBeLessThan(before.amount);
  });

  it('gives mental study a 10 percent reward bonus on only the first 45 minutes per day',()=>{
    const sessions=[
      {...piano('mental-a',1800,'2026-09-20T09:00:00Z','g',6),activityType:'mental',activityFactor:1},
      {...piano('mental-b',1800,'2026-09-20T10:00:00Z','g',6),activityType:'mental',activityFactor:1}
    ];
    const rows=P.ledger(sessions,[goal()]);
    const bonuses=P.mentalBonusRows(rows,'2026-09-20');
    expect(P.summarizeDays(sessions)['2026-09-20']).toBe(3600);
    expect(bonuses).toHaveLength(1);
    expect(bonuses[0]).toMatchObject({date:'2026-09-20',mentalBonus:true,eligibleSeconds:2700});
    const expected=(P.baseReward(2700,P.POLICIES[6])-P.baseReward(0,P.POLICIES[6]))*.10;
    expect(P.rowEffortPoints(bonuses[0])).toBeCloseTo(expected,6);
  });

  it('does not backdate the mental-study bonus before 20 September 2026',()=>{
    const rows=P.ledger([
      {...piano('mental-old',3600,'2026-09-19T10:00:00Z','g',6),activityType:'mental',activityFactor:1}
    ],[goal()]);
    expect(P.mentalBonusRows(rows,'2026-09-19')).toEqual([]);
  });

  it('shows the mental bonus in the live taximeter without adding net time',()=>{
    const state={sessions:[],effortWallet:{version:1,seedGoalIds:['g'],seedCostPoints:{g:150},displayGoalId:'g',redemptions:[]}};
    const live=P.live(state,[goal()],'g',3600,'2026-09-20',[],6,'mental');
    const expectedBase=P.baseReward(3600,P.POLICIES[6]);
    const expectedBonus=P.baseReward(2700,P.POLICIES[6])*.10;
    expect(live.seconds).toBe(3600);
    expect(live.equivalentCurrentSeconds).toBe(3600);
    expect(live.today).toBeCloseTo(expectedBase+expectedBonus,6);
    expect(live.walletPoints).toBeCloseTo(expectedBase+expectedBonus,6);
  });

});
