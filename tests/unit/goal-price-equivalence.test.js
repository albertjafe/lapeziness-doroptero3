import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),P=require('../../piano-rewards.js'),G=require('../../german-rewards.js');
const goal={id:'kindle',name:'Kindle',amount:220,createdAt:'2026-09-01T10:00:00Z'};
const german=Array.from({length:30},(_,i)=>{
  const day=G.shiftDay('2026-09-01',i);
  return {id:'de-'+i,goalId:goal.id,startedAt:day+'T10:00:00Z',segments:[{day,seconds:3600}]};
});
const piano=german.map((s,i)=>({id:'p-'+i,goalId:goal.id,date:s.segments[0].day,startedAt:s.startedAt,seconds:5*3600,activityType:'study',policyVersion:4}));
const progress=(goals,gs=german,ps=piano)=>G.goalProgress(goals[0],P.combinedLedger(G.ledger(gs,goals),P.ledger(ps,goals),goals),gs);

describe('the same purchase recomputes earnings when its price changes',()=>{
  it('matches a goal started at the new price with identical study evidence',()=>{
    const before=structuredClone({goal,german,piano});
    const gs=german.slice(0,20),ps=piano.slice(0,20);
    const old=progress([goal],gs,ps),updated={...goal,amount:150},next=progress([updated],gs,ps);
    expect(next.amount).toBeLessThan(old.amount);
    expect(next.amount/150).toBeGreaterThan(old.amount/220);
    // Away from the cap, price scaling should change rewards but preserve effort.
    expect(next.amount/old.amount).toBeCloseTo((150/220)**.45,5);
    expect({goal,german,piano}).toEqual(before);
    expect(next.seconds).toBe(old.seconds);
  });
  it('caps a cheaper purchase at its new price and assigns no surplus to the next goal',()=>{
    const updated={...goal,amount:50},other={id:'next',amount:200,createdAt:'2026-10-01T10:00:00Z'};
    const goals=[updated,other],rows=P.combinedLedger(G.ledger(german,goals),P.ledger(piano,goals),goals);
    expect(G.goalProgress(updated,rows,german)).toMatchObject({amount:50,complete:true});
    expect(G.goalProgress(other,rows,german)).toMatchObject({amount:0,complete:false});
  });
  it('reopens completion after a price increase and applies legacy policy parameters',()=>{
    const low={...goal,amount:50},high={...goal,amount:500,rewardPolicy:{...G.CONFIG,scaleExponent:.2}};
    expect(progress([low]).complete).toBe(true);
    expect(progress([high]).complete).toBe(false);
    expect(progress([high]).amount).toBeGreaterThan(0);
  });
});
