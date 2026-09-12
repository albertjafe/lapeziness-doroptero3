import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), R=require('../../german-rewards.js'), S=require('../../german-srs.js'), I=require('../../german-import.js'), T=require('../../german-session.js'), D=require('../../document-sync-core.js');
const goal=(id='g',amount=150)=>({id,amount,createdAt:'2026-09-01T10:00:00Z'});
const session=(id,seconds,day='2026-09-12',goalId='g')=>({id,goalId,startedAt:day+'T10:00:00Z',status:'finished',segments:[{id:day,day,seconds}]});
const total=rows=>rows.reduce((n,r)=>n+r.finalReward,0);

describe('Deutsch reward policy and ledger',()=>{
  it.each([[900,1],[1800,1.25],[2700,1.55],[3600,2],[7200,2]])('%s seconds -> %s euros', (s,e)=>expect(R.baseReward(s)).toBe(e));
  it('interpolates continuously and does not accumulate per-frame amounts',()=>{
    expect(R.baseReward(450)).toBe(.5);expect(R.baseReward(1350)).toBe(1.125);expect(R.baseReward(3150)).toBeCloseTo(1.775);
    expect(R.baseReward(899.9)).toBeLessThan(1);expect(R.baseReward(-2)).toBe(0);
  });
  it('scales sublinearly with both clamps',()=>{
    expect(R.goalScale(150)).toBe(1);expect(R.goalScale(10)).toBe(.5);expect(R.goalScale(50000)).toBeCloseTo((50000/150)**.45);
    expect(R.goalScale(1e8)).toBe(15);
  });
  it.each([[1,1],[3,1],[4,1.05],[7,1.05],[8,1.1],[12,1.15],[16,1.2],[20,1.25],[99,1.25]])('streak %s has multiplier %s',(n,m)=>expect(R.streakMultiplier(n)).toBe(m));
  it('does not qualify under 15 minutes but combines multiple same-day sessions',()=>{
    expect(total(R.ledger([session('a',899)], [goal()]))).toBe(0);
    const rows=R.ledger([session('a',480),session('b',480)],[goal()]);
    expect(total(rows)).toBeCloseTo(R.baseReward(960));expect(rows.every(r=>r.qualified)).toBe(true);
  });
  it('caps the whole day across sessions and goal changes',()=>{
    expect(total(R.ledger([session('a',3600),session('b',3600)],[goal()]))).toBe(2);
    const rows=R.ledger([session('a',3600),session('b',3600,'2026-09-12','g2')],[goal(),goal('g2',300)]);
    expect(rows[1].finalReward).toBe(0);
  });
  it('caps at the target and records goal completion without resetting study',()=>{
    const sessions=[session('a',3600)];const g=goal('g',.5);const rows=R.ledger(sessions,[g]);
    expect(total(rows)).toBe(.5);expect(R.goalProgress(g,rows,sessions)).toMatchObject({complete:true,completedOn:'2026-09-12',seconds:3600});
  });
  it('qualifies fourth-day bonus and breaks a streak after a missed local day',()=>{
    const sessions=[9,10,11,12].map(n=>session(String(n),900,'2026-09-'+n.toString().padStart(2,'0')));
    expect(R.ledger(sessions,[goal()]).at(-1).finalReward).toBe(1.05);
    expect(R.streakStats(sessions,'2026-09-13')).toMatchObject({current:4,best:4,nextBonusIn:4});
    expect(R.streakStats(sessions,'2026-09-14').current).toBe(0);
    expect(R.streakStats([...sessions,session('x',899,'2026-09-13')],'2026-09-14').current).toBe(0);
  });
  it('uses calendar days across leap years, month boundaries and DST',()=>{
    expect(R.shiftDay('2024-03-01',-1)).toBe('2024-02-29');expect(R.shiftDay('2026-01-01',-1)).toBe('2025-12-31');
    expect(R.shiftDay('2026-03-29',1)).toBe('2026-03-30');expect(R.shiftDay('2026-10-25',1)).toBe('2026-10-26');
    expect(R.dayKey(new Date(2026,8,12,0,1))).toBe('2026-09-12');
  });
  it('rebuilds identically after reverse-order offline merges and repeated finalization',()=>{
    const a={germanStudy:{sessions:[session('a',900)],goals:[goal()]}}, b={germanStudy:{sessions:[session('b',2700)],goals:[goal()]}};
    const merged=D.mergeRemote(a,b).germanStudy, reverse=D.mergeRemote(b,a).germanStudy;
    expect(R.ledger(merged.sessions,merged.goals)).toEqual(R.ledger(reverse.sessions,reverse.goals));
    T.finish(merged,'a',Date.now());const ledger=structuredClone(merged.ledger),ended=merged.sessions.find(s=>s.id==='a').endedAt;
    T.finish(merged,'a',Date.now()+10000);expect(merged.ledger).toEqual(ledger);expect(merged.sessions.find(s=>s.id==='a').endedAt).toBe(ended);expect(total(ledger)).toBe(2);
  });
});

describe('Deutsch timer evidence',()=>{
  it('splits midnight exactly without a fixed length day',()=>{
    const s=T.create({id:'s',deviceId:'d'}), start=new Date(2026,8,12,23,59,59).getTime();
    T.addInterval(s,start,start+2000);expect(s.segments).toEqual([{id:'2026-09-12',day:'2026-09-12',seconds:1},{id:'2026-09-13',day:'2026-09-13',seconds:1}]);
  });
  it('pauses hidden, abandoned, backwards-clock and long-gap runs without adding time',()=>{
    for(const options of [{now:3600000,lastTick:0,lastInteraction:0},{now:1000,lastTick:0,lastInteraction:0,visible:false},{now:-1000,lastTick:0,lastInteraction:0},{now:400000,lastTick:399000,lastInteraction:0}]){
      const s=T.create({id:'s',deviceId:'d'});s.status='running';expect(T.tick(s,options)).toBe(false);expect(s.segments).toEqual([]);expect(s.status).toBe('paused');
    }
  });
  it('records real elapsed milliseconds, cannot add to a finished run',()=>{
    const s=T.create({id:'s',deviceId:'d'});s.status='running';T.tick(s,{now:1250,lastTick:0,lastInteraction:0});expect(s.segments[0].seconds).toBe(1.25);
    s.endedAt=new Date().toISOString();T.addInterval(s,1250,2000);expect(s.segments[0].seconds).toBe(1.25);
  });
});

describe('Deutsch material import',()=>{
  it('validates and imports canonical JSON atomically with deterministic identifiers',async()=>{
    const pack=await I.parse(JSON.stringify(I.EXAMPLE));const st={materials:[]};expect(I.insert(st,pack)).toBe(true);expect(I.insert(st,await I.parse(JSON.stringify(I.EXAMPLE,null,4)))).toBe(false);
    expect(st.materials).toHaveLength(1);expect(pack.cards[0].id).not.toBe(pack.exercises[0].id);
  });
  it('canonicalizes root key order and optional empty fields for duplicate detection',async()=>{
    const a=await I.parse(JSON.stringify(I.EXAMPLE)), b=await I.parse(JSON.stringify({exercises:I.EXAMPLE.exercises,cards:I.EXAMPLE.cards,metadata:I.EXAMPLE.metadata,schema:I.SCHEMA}));expect(a.id).toBe(b.id);
  });
  it.each([
    [{...I.EXAMPLE,schema:'v2'},'schema'],
    [{...I.EXAMPLE,cards:[{type:'de_es',front:'a'}]},'back'],
    [{...I.EXAMPLE,exercises:[{type:'translation',prompt:'x'}]},'answer'],
    [{...I.EXAMPLE,metadata:{title:'x',date:'2026-02-30'}},'date'],
    [{...I.EXAMPLE,cards:[{type:'de_es',front:'x',back:'y',tags:'tag'}]},'tags'],
    [{...I.EXAMPLE,cards:[],exercises:[]},'entre 1'],
    [{...I.EXAMPLE,cards:[{type:'unknown',front:'x',back:'y'}]},'type']
  ])('rejects invalid package without mutation',async(input,error)=>{await expect(I.parse(JSON.stringify(input))).rejects.toThrow(error);});
  it('reports every invalid row, rejects oversized input and malformed JSON',async()=>{
    const result=I.validate({...I.EXAMPLE,cards:[{},{}]});expect(result.errors.some(e=>e.includes('cards[0]'))).toBe(true);expect(result.errors.some(e=>e.includes('cards[1]'))).toBe(true);
    await expect(I.parse('x'.repeat(I.MAX_BYTES+1))).rejects.toThrow('2 MB');await expect(I.parse('{')).rejects.toThrow('JSON inválido');
  });
  it('reads BOM, quoted CSV commas/newlines/escapes and rejects broken CSV',async()=>{
    const p=await I.parse('\uFEFFfront,back\r\n"Guten Tag, Anna","Hola\nAnna"\r\n"Er sagt ""Hallo""",Hola','words.csv');
    expect(p.cards[0]).toMatchObject({front:'Guten Tag, Anna',back:'Hola\nAnna'});expect(p.cards[1].front).toBe('Er sagt "Hallo"');
    await expect(I.parse('front,back\na,"b','words.csv')).rejects.toThrow('comillas');
    await expect(I.parse('front,back\na,b,c','words.csv')).rejects.toThrow('columnas');
  });
});

describe('Deutsch SRS and mixed session',()=>{
  it('deterministically schedules all grades and preserves review history',()=>{
    const now=Date.parse('2026-09-12T12:00:00Z');expect(S.schedule({},'again',now).nextReview).toBe('2026-09-12T12:01:00.000Z');
    expect(S.schedule({},'hard',now).interval).toBe(1);expect(S.schedule({},'good',now).interval).toBe(1);expect(S.schedule({},'easy',now).interval).toBe(4);
    const reviews=[{id:'b',cardId:'c',grade:'good',at:'2026-09-13T12:00:00Z'},{id:'a',cardId:'c',grade:'good',at:'2026-09-12T12:00:00Z'}];
    expect(S.cardState('c',reviews)).toMatchObject({reviews:2,interval:3,ease:2.5});expect(S.cardState('c',reviews)).toEqual(S.cardState('c',[...reviews].reverse()));
  });
  it('prioritizes due, limited new, then pending exercises; isolates mode/material',()=>{
    const st={materials:[{id:'m',cards:['due','new1','new2'].map(id=>({id})),exercises:[{id:'e'}]}],reviews:[{id:'r',cardId:'due',grade:'good',at:'2020-01-01T00:00:00Z'}]};
    expect(S.queue(st,{newLimit:1}).map(x=>x.id)).toEqual(['due','new1','e']);expect(S.queue(st,{mode:'exercises'}).map(x=>x.id)).toEqual(['e']);expect(S.queue(st,{materialId:'missing'})).toEqual([]);
  });
  it('checks accepted literal answers while retaining umlauts; free writing is self-graded',()=>{
    expect(S.correct({answer:'du wartest'},' Du  wartest! ')).toBe(true);expect(S.correct({acceptedAnswers:['wartest']},'wartest')).toBe(true);
    expect(S.correct({answer:'schön'},'schon')).toBe(false);expect(S.correct({type:'free_write'},'x')).toBeNull();
  });
});
