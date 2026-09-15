import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const R=require('../../german-rewards.js');
const P=require('../../piano-rewards.js');
const D=require('../../document-sync-core.js');
const goal=(id='g',amount=150)=>({id,name:'Kindle',amount,createdAt:'2026-09-01T10:00:00Z'});
const piano=(id,seconds,startedAt='2026-09-12T10:00:00Z',goalId='g',policyVersion=3)=>({id,goalId,startedAt,endedAt:startedAt,date:startedAt.slice(0,10),seconds,policyVersion});

describe('piano progressive taximeter',()=>{
  it.each([[0,0],[1800,.05],[3600,.11],[5400,.18],[7200,.27],[9000,.38],[10800,.53],[12600,.75],[14400,1.05],[16200,1.43],[18000,1.93],[19800,2.58],[21600,3.38],[23400,4.38],[25200,5.50],[30000,5.50]])('%s seconds -> %s euros at the reference goal',(seconds,amount)=>{
    expect(P.baseReward(seconds)).toBeCloseTo(amount,8);
  });

  it('starts the stronger curve earlier, increases every half-hour rate and keeps a hard seven-hour cap',()=>{
    const increments=P.CONFIG.curve.slice(1).map(([,amount],index)=>amount-P.CONFIG.curve[index][1]);
    increments.slice(1).forEach((increment,index)=>expect(increment).toBeGreaterThan(increments[index]));
    expect(P.baseReward(4*3600)).toBe(1.05);
    expect(P.baseReward(8*3600)).toBe(P.baseReward(7*3600));
    expect(3*P.baseReward(7*3600)).toBeLessThan(150);
  });

  it.each([[1,1],[2,1],[3,1.05],[4,1.05],[5,1.10],[6,1.10],[7,1.15],[9,1.15],[10,1.20],[13,1.20],[14,1.25],[99,1.25]])('full-day streak %s has multiplier %s',(days,multiplier)=>{
    expect(P.streakMultiplier(days)).toBe(multiplier);
  });

  it('uses the existing sublinear goal scale for small and large targets',()=>{
    const small=P.ledger([piano('small',25200,'2026-09-12T10:00:00Z','small')],[goal('small',50)]);
    const reference=P.ledger([piano('reference',25200)],[goal()]);
    const large=P.ledger([piano('large',25200,'2026-09-12T10:00:00Z','large')],[goal('large',50000)]);
    expect(small[0].finalReward).toBeCloseTo(5.50*R.goalScale(50),6);
    expect(reference[0].finalReward).toBe(5.50);
    expect(large[0].finalReward).toBeCloseTo(5.50*R.goalScale(50000),6);
  });

  it('shares the daily curve across split sessions without rounding drift',()=>{
    const rows=P.ledger([
      piano('a',3600,'2026-09-12T09:00:00Z'),
      piano('b',10800,'2026-09-12T11:00:00Z'),
      piano('c',10800,'2026-09-12T15:00:00Z')
    ],[goal()]);
    expect(rows.reduce((sum,row)=>sum+row.microEuros,0)).toBe(5500000);
    expect(rows.map(row=>row.finalReward)).toEqual([.11,.94,4.45]);
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

  it('applies the full-day streak multiplier to the whole qualifying day',()=>{
    const sessions=[
      piano('d1',14400,'2026-09-10T10:00:00Z'),
      piano('d2',14400,'2026-09-11T10:00:00Z'),
      piano('d3a',7200,'2026-09-12T09:00:00Z'),
      piano('d3b',7200,'2026-09-12T12:00:00Z')
    ];
    const rows=P.ledger(sessions,[goal()]),day3=rows.filter(row=>row.date==='2026-09-12');
    expect(day3.every(row=>row.streakDays===3&&row.streakMultiplier===1.05&&row.fullDay)).toBe(true);
    expect(day3.reduce((sum,row)=>sum+row.finalReward,0)).toBeCloseTo(1.05*1.05,6);
  });

  it('keeps v1 and v2 sessions on their original policies without retroactive streak bonuses',()=>{
    const legacy=piano('legacy',25200,'2026-09-12T10:00:00Z','g',1);delete legacy.policyVersion;
    expect(P.ledger([legacy],[goal()])[0].finalReward).toBe(2.60);
    const oldV2=piano('v2',14400,'2026-09-13T10:00:00Z','g',2);
    const row=P.ledger([piano('prior',14400,'2026-09-12T10:00:00Z'),oldV2],[goal()]).find(item=>item.sessionId==='v2');
    expect(row.finalReward).toBe(.75);
    expect(row.streakMultiplier).toBe(1);
  });

  it('records a finished stopwatch run only once under policy v3',()=>{
    const state={sessions:[]};
    expect(P.record(state,{id:'short',goalId:'g',startedAt:'2026-09-12T09:00:00Z',endedAt:'2026-09-12T09:09:59Z',seconds:599})).toBe(false);
    const input={id:'run-1',goalId:'g',startedAt:'2026-09-12T10:00:00Z',endedAt:'2026-09-12T10:30:00Z',seconds:1800};
    expect(P.record(state,input)).toBe(true);
    expect(P.record(state,input)).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({id:'run-1',goalId:'g',date:'2026-09-12',seconds:1800,policyVersion:3});
  });

  it('keeps independently finished piano runs after an offline document merge',()=>{
    const left={pianoRewards:{version:1,sessions:[piano('left',1800,'2026-09-12T09:00:00Z')]}};
    const right={pianoRewards:{version:1,sessions:[piano('right',1800,'2026-09-12T10:00:00Z')]}};
    expect(D.mergeRemote(left,right).pianoRewards.sessions.map(item=>item.id).sort()).toEqual(['left','right']);
  });

  it('combines German and piano chronologically and never exceeds the shared target',()=>{
    const g=goal('g',1);
    const german=[{id:'de',date:'2026-09-12',startedAt:'2026-09-12T09:00:00Z',goalId:'g',source:'german',duration:900,qualified:true,potentialMicroEuros:700000,microEuros:700000,finalReward:.7}];
    const pianoRows=P.ledger([piano('pi',21600,'2026-09-12T10:00:00Z')],[g]);
    const rows=P.combinedLedger(german,pianoRows,[g]);
    expect(rows.reduce((sum,row)=>sum+row.finalReward,0)).toBe(1);
    expect(rows[1].finalReward).toBe(.3);
  });

  it('shows a second-by-second live increment and respects money already earned in German',()=>{
    const state={sessions:[piano('saved',3600)]},goals=[goal()];
    const german=[{id:'de',date:'2026-09-11',startedAt:'2026-09-11T09:00:00Z',goalId:'g',source:'german',duration:900,qualified:true,potentialMicroEuros:149850000,microEuros:149850000,finalReward:149.85}];
    const one=P.live(state,goals,'g',1,'2026-09-12',german);
    const two=P.live(state,goals,'g',2,'2026-09-12',german);
    expect(two.today).toBeGreaterThan(one.today);
    expect(two.increment).toBeLessThanOrEqual(.07);
    expect(two.goalRemaining).toBeGreaterThanOrEqual(0);
  });

  it('upgrades the whole live day when the third full day crosses four hours',()=>{
    const state={sessions:[
      piano('d1',14400,'2026-09-10T10:00:00Z'),
      piano('d2',14400,'2026-09-11T10:00:00Z'),
      piano('today',12600,'2026-09-12T09:00:00Z')
    ]},goals=[goal()];
    const live=P.live(state,goals,'g',1800,'2026-09-12');
    expect(live).toMatchObject({fullDay:true,streakDays:3,streakMultiplier:1.05});
    expect(live.today).toBeCloseTo(1.1025,6);
    expect(live.increment).toBeCloseTo(.3525,6);
  });
});
