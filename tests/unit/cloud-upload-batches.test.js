import {describe,it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {cloudAppHarness} from '../fixtures/cloud-app-harness.js';
const D=createRequire(import.meta.url)('../../document-sync-core.js');

describe('bounded recovery uploads',()=>{
  it('converges with nested edits, clears and deletions without advancing clocks for omitted values',()=>{
    const base={label:'old',preferences:{value:'old',tags:['a']},sessionPlants:[{id:'old',mins:10}],obras:[{id:'w',name:'old'}]};
    const next=structuredClone(base);next.label='new';next.preferences={value:'new',tags:[]};next.sessionPlants=[];next.obras[0].name='new';
    next.germanStudy={cards:Array.from({length:9},(_,i)=>({id:'c'+i,front:'word '+i,back:'meaning'}))};
    const desired=D.mergeRemote(base,D.track(next,base,'2026-09-22T12:00:00Z'));
    let server=base,passes=0;
    while(!D.sameContent(server,desired)&&passes++<30){
      const batch=D.uploadBatch(server,desired,{maxRecords:2,maxChars:90});
      expect(D.sameContent(server,batch.expected)).toBe(false);
      server=D.mergeRemote(server,batch.data);
      expect(server).toEqual(batch.expected);
      expect(batch.remaining).toBe(!D.sameContent(server,desired));
    }
    expect(passes).toBeGreaterThan(1);expect(passes).toBeLessThan(30);expect(server).toEqual(desired);
  });
  it('limits legacy mass edits while retaining complete anonymous identities and oversized records',()=>{
    const server={forestPlants:Array.from({length:300},(_,i)=>({id:'f'+i,mins:30})),sessionPlants:[]};
    const next=structuredClone(server);next.forestPlants.forEach(p=>p.note='restored');next.sessionPlants.push({id:'recent',mins:86});
    next.unknown=[{weekStart:'2026-09-21',nested:{large:'x'.repeat(300000)}}];
    const desired=D.mergeRemote(server,D.track(next,server,'2026-09-22T12:00:00Z'));
    let remote=server,batches=0;
    while(!D.sameContent(remote,desired)&&batches++<10){
      const batch=D.uploadBatch(remote,desired);
      expect((batch.data.forestPlants?.length||0)+(batch.data.sessionPlants?.length||0)).toBeLessThanOrEqual(128);
      if(batches===1)expect(batch.data.sessionPlants).toHaveLength(1);
      remote=D.mergeRemote(remote,batch.data);
    }
    expect(remote).toEqual(desired);expect(batches).toBeGreaterThan(2);expect(batches).toBeLessThan(10);
  });
  it('keeps partial confirmations dirty after a timeout, throttles retries and resumes without duplicates',async()=>{
    const base={sessionPlants:[],forestPlants:[]};
    const local={sessionPlants:Array.from({length:300},(_,i)=>({id:'p'+i,mins:30})),forestPlants:[]};
    let row={data:base,updated_at:'v1'},writes=0,fail=true;
    const h=cloudAppHarness(local,base,{meta:null,query:async({operation,value})=>{
      if(operation==='read')return {data:structuredClone(row)};
      writes++;
      if(writes===2&&fail)return {error:{code:'57014'}};
      row={data:D.mergeRemote(row.data,value.data),updated_at:'v'+writes};return {data:structuredClone(row)};
    }});
    const ctx=h.boot();ctx.saveLocalNow();
    expect(await ctx.syncPendingCloudChanges()).toBe(false);
    expect(row.data.sessionPlants).toHaveLength(128);
    expect(h.state().local.sessionPlants).toHaveLength(300);
    expect(h.state().meta.dirtyRevision).toBeGreaterThan(h.state().meta.lastSyncedRevision);
    expect(ctx.cloudRetryDelay()).toBeGreaterThan(0);
    for(let i=0;i<5;i++)expect(await ctx.requestCloudRefresh()).toBe(false);
    expect(writes).toBe(2);
    fail=false;ctx._cloudRetryAt=0;
    expect(await ctx.syncPendingCloudChanges()).toBe(true);
    expect(row.data.sessionPlants).toHaveLength(300);expect(writes).toBe(4);
    expect(h.state().meta.dirtyRevision).toBe(h.state().meta.lastSyncedRevision);
  });
});
