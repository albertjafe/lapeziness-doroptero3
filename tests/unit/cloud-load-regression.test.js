import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
import {cloudAppHarness as harness,saveUnrelatedOffline} from '../fixtures/cloud-app-harness.js';
const SyncCore=createRequire(import.meta.url)('../../sync-core.js');
const original={_localRevision:100,_savedAt:'2026-09-04T10:00:00Z',obras:[{id:'w',name:'Sonata',dificultad:9}],cronoTasks:[]};

describe('loadFromCloud reconciliation without redundant writes',()=>{
  it.each([true,false])('200 unrelated offline saves cannot regress difficulty on reconnect (download first: %s)',async download=>{
    const stale={...structuredClone(original),_localRevision:20};stale.obras[0].dificultad=5;
    const h=harness(stale,original,{meta:null}),ctx=h.boot();
    saveUnrelatedOffline(ctx);
    expect(h.state()).toMatchObject({writes:0,reads:0,local:{_localRevision:220,obras:[{dificultad:5}]}});
    expect(ctx.db.obras[0]._fieldClock?.dificultad).toBeUndefined();
    await h.reconnect(download);
    expect(h.state()).toMatchObject({writes:1,local:{obras:[{dificultad:9}],cronoTasks:[{id:'offline-task',text:'Nueva tarea 199'}]},
      row:{data:{obras:[{dificultad:9}],cronoTasks:[{id:'offline-task',text:'Nueva tarea 199'}]}}});
    expect(SyncCore.isDirty(h.state().meta)).toBe(false);
    await h.open();expect(h.state().writes).toBe(1);
  });
  it('discards an unclocked stale scalar with a higher revision without uploading an echo',async()=>{
    const stale=structuredClone(original);stale._localRevision=10000;stale.obras[0].dificultad=5;
    const h=harness(stale,original,{meta:{localRevision:10000,dirtyRevision:10000,lastSyncedRevision:100}});
    await h.open();expect(h.state()).toMatchObject({writes:0,queued:0,local:{obras:[{dificultad:9}]}});
    expect(SyncCore.isDirty(h.state().meta)).toBe(false);
  });
  it('opens ten times with local == remote and writes user_data zero times',async()=>{
    const h=harness(original,original);
    for(let i=0;i<10;i++)expect(await h.open()).toBe(true);
    expect(h.state()).toMatchObject({writes:0,reads:10,queued:0,local:original,meta:{localRevision:100,lastSyncedRevision:100}});
  });
  it('ignores object key order and transport metadata when deciding whether to upload',async()=>{
    const remote={cronoTasks:[],obras:[{dificultad:9,name:'Sonata',id:'w'}],_savedAt:'2026-09-04T11:00:00Z',_localRevision:110};
    const h=harness(original,remote);await h.open();await h.open();
    expect(h.state()).toMatchObject({writes:0,queued:0,local:{_localRevision:110}});
    expect(SyncCore.isDirty(h.state().meta)).toBe(false);
  });
  it('downloads newer remote data without echoing the remote document back',async()=>{
    const remote=structuredClone(original);remote._localRevision=110;remote.obras[0].dificultad=10;
    const h=harness(original,remote);await h.open();
    expect(h.state()).toMatchObject({writes:0,local:{obras:[{dificultad:10}]}});
  });
  it('uploads real independent local changes even when metadata incorrectly says clean',async()=>{
    const local=structuredClone(original);local.cronoTasks.push({id:'t',text:'Nueva'});
    const h=harness(local,original);await h.open();await h.open();
    expect(h.state()).toMatchObject({writes:1,row:{data:{cronoTasks:[{id:'t'}],obras:[{dificultad:9}]}}});
  });
  it.each(['lost','clean'])('creates an absent cloud row when valid local data has %s sync metadata',async state=>{
    const h=harness(original,null,{meta:state==='lost'?null:{localRevision:0,dirtyRevision:0,lastSyncedRevision:0}});
    await h.open();await h.open();
    expect(h.state()).toMatchObject({writes:1,row:{data:{obras:[{id:'w',dificultad:9}]}}});
    expect(SyncCore.isDirty(h.state().meta)).toBe(false);
  });
  it('does not confuse a failed read with an empty cloud account',async()=>{
    const h=harness(original,null,{failRead:true});expect(await h.open()).toBe(false);
    expect(h.state()).toMatchObject({writes:0,local:original});
  });
  it('keeps an explicit local edit made while the remote read was pending',async()=>{
    const h=harness(original,original,{beforeRead:(ctx,reads)=>{if(reads===1){ctx.db.obras[0].dificultad=8;ctx.saveLocalNow();}}});
    await h.open();
    expect(h.state()).toMatchObject({writes:1,local:{obras:[{dificultad:8}]},row:{data:{obras:[{dificultad:8}]}}});
  });
});
