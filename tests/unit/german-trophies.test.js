import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), G=require('../../german-trophies.js');
const goal=(id,amount=.5,extra={})=>({id,name:id,amount,createdAt:'2026-09-01T10:00:00Z',...extra});
const session=(id,goalId,day,seconds)=>({id,goalId,startedAt:day+'T23:50:00Z',segments:[{day,seconds}]});

describe('Trophy collection from real goal evidence',()=>{
  it('includes completed goals before AND after archiving, with evidence dates',()=>{
    const state={goals:[goal('old',.5,{archivedAt:'2026-09-10T10:00:00Z'}),goal('new')],sessions:[session('a','old','2026-09-02',3600),session('b','new','2026-09-03',3600)]};
    expect(G.collection(state).map(x=>[x.goal.id,x.status,x.completedOn,x.startedOn])).toEqual([
      ['new','complete','2026-09-03','2026-09-03'],['old','complete','2026-09-02','2026-09-02']]);
  });
  it('keeps creation, real first study and completion separate, ignoring zero-time openings',()=>{
    const s=session('cross','g','2026-09-03',450);s.segments.push({day:'2026-09-04',seconds:3600});
    const [item]=G.collection({goals:[goal('g')],sessions:[session('empty','g','2026-09-01',0),s]});
    expect(item).toMatchObject({startedOn:'2026-09-03',completedOn:'2026-09-04',studyDays:2,seconds:4050,percent:100});
    expect(item.goal.createdAt).toBe('2026-09-01T10:00:00Z');
  });
  it('never awards a trophy from archive flags, stale ledgers or a supplied completedAt',()=>{
    const [item]=G.collection({goals:[goal('g',50,{archivedAt:'2026-09-12T12:00:00Z',completedAt:'2026-09-10T12:00:00Z'})],sessions:[session('short','g','2026-09-02',899)],ledger:[{goalId:'g',microEuros:50000000}]});
    expect(item).toMatchObject({complete:false,status:'archived',amount:0,completedOn:null,startedOn:'2026-09-02'});
  });
  it('represents unstarted, active and queued goals without inventing start dates',()=>{
    const goals=[goal('b',50),goal('a',50)];
    expect(G.collection({goals,sessions:[]}).map(x=>[x.goal.id,x.status,x.startedOn])).toEqual([['a','new',null],['b','queued',null]]);
    const items=G.collection({goals,sessions:[session('s','a','2026-09-02',3600)]});
    expect(items[0]).toMatchObject({status:'active',complete:false,completedOn:null});
    expect(items[1].startedOn).toBeNull();
  });
  it('is deterministic after reordered merges, read-only, and retains the first completion day',()=>{
    const state={goals:[goal('g')],sessions:[session('later','g','2026-09-08',3600),session('earlier','g','2026-09-02',3600)]};
    const before=structuredClone(state), result=G.collection(state);
    expect(state).toEqual(before);
    expect(result).toEqual(G.collection({goals:[...state.goals].reverse(),sessions:[...state.sessions].reverse()}));
    expect(result[0].completedOn).toBe('2026-09-02');
    expect(result[0].seconds).toBe(7200);
  });
  it('counts actual study days once across sessions and excludes free study from goal totals',()=>{
    const [item]=G.collection({goals:[goal('g',50)],sessions:[session('a','g','2026-09-02',450),session('b','g','2026-09-02',450),session('free',null,'2026-09-03',3600)]});
    expect(item).toMatchObject({studyDays:1,seconds:900,startedOn:'2026-09-02'});
  });
  it('handles an empty collection and keeps SVG user data inert',()=>{
    expect(G.collection({})).toEqual([]);
    const art=G.artwork('<img src=x onerror=alert(1)>',true,'hero');
    expect(art).not.toContain('<img');expect(art).toContain('aria-hidden="true"');
  });
});
