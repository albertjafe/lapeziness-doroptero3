import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const R=require('../../german-rewards.js');
const P=require('../../piano-rewards.js');
const D=require('../../document-sync-core.js');
const goal=(id='g',amount=150)=>({id,name:'Kindle',amount,createdAt:'2026-09-01T10:00:00Z'});
const piano=(id,seconds,startedAt='2026-09-12T10:00:00Z',goalId='g',policyVersion=2)=>({id,goalId,startedAt,endedAt:startedAt,date:'2026-09-12',seconds,policyVersion});

describe('piano progressive taximeter',()=>{
  it.each([[0,0],[1800,.035],[3600,.08],[5400,.13],[7200,.20],[9000,.29],[10800,.40],[12600,.55],[14400,.75],[16200,1],[18000,1.35],[19800,1.85],[21600,2.60],[23400,3.75],[25200,5.50],[30000,5.50]])('%s seconds -> %s euros at the reference goal',(seconds,amount)=>{
    expect(P.baseReward(seconds)).toBeCloseTo(amount,8);
  });

  it('increases every half-hour rate and keeps a hard seven-hour cap',()=>{
    const increments=P.CONFIG.curve.slice(1).map(([,amount],index)=>amount-P.CONFIG.curve[index][1]);
    increments.slice(1).forEach((increment,index)=>expect(increment).toBeGreaterThan(increments[index]));
    expect(P.baseReward(8*3600)).toBe(P.baseReward(7*3600));
    expect(3*P.baseReward(7*3600)).toBeLessThan(150);
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
    expect(rows.map(row=>row.finalReward)).toEqual([.08,.67,4.75]);
  });

  it('keeps sessions saved before v384 on their original six-hour policy',()=>{
    const legacy=piano('legacy',25200);delete legacy.policyVersion;
    expect(P.ledger([legacy],[goal()])[0].finalReward).toBe(2.60);
  });

  it('records a finished stopwatch run only once',()=>{
    const state={sessions:[]};
    expect(P.record(state,{id:'short',goalId:'g',startedAt:'2026-09-12T09:00:00Z',endedAt:'2026-09-12T09:09:59Z',seconds:599})).toBe(false);
    const input={id:'run-1',goalId:'g',startedAt:'2026-09-12T10:00:00Z',endedAt:'2026-09-12T10:30:00Z',seconds:1800};
    expect(P.record(state,input)).toBe(true);
    expect(P.record(state,input)).toBe(false);
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]).toMatchObject({id:'run-1',goalId:'g',date:'2026-09-12',seconds:1800,policyVersion:2});
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
});
