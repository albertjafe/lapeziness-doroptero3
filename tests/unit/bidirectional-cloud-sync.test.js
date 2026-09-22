import {describe,it,expect} from 'vitest';
import {cloudAppHarness} from '../fixtures/cloud-app-harness.js';
import {createRequire} from 'node:module';
const Doc=createRequire(import.meta.url)('../../document-sync-core.js');

const initial={_localRevision:100,obras:[{id:'w',name:'Sonata'}],sessionPlants:[],germanStudy:{version:1,materials:[],reviews:[],sessions:[],ledger:[],goals:[{id:'kindle',name:'Kindle',amount:200,createdAt:'2026-09-18T00:00:00Z'}]}};
function sharedCloud(){
  let row={id:'u',updated_at:'v1',data:structuredClone(initial)},version=1,offline=new Set(),probes=0,writes=0,conflicts=0;
  const query=async({operation,value,expected,selection,ctx})=>{
    await Promise.resolve();
    if(offline.has(ctx))return {error:{code:'NETWORK',message:'offline'}};
    if(operation==='read'){
      if(selection==='updated_at'){probes++;return {data:{updated_at:row.updated_at}};}
      return {data:structuredClone(row)};
    }
    if(operation==='update'&&expected!==row.updated_at){conflicts++;return {data:null};}
    row={...structuredClone(value),data:Doc.mergeRemote(row.data,value.data),updated_at:'v'+(++version)};writes++;
    return {data:structuredClone(row)};
  };
  const device=()=>cloudAppHarness(initial,initial,{query});
  return {device,offline,state:()=>({row,probes,writes,conflicts})};
}
function study(ctx,id,mins){ctx.db.sessionPlants.push({id,mins,startedAt:'2026-09-18T08:00:00Z'});ctx.saveLocalNow();}
const minutes=ctx=>ctx.db.sessionPlants.reduce((total,p)=>total+p.mins,0);

describe('real app synchronization between independent devices',()=>{
  it('a dirty stale phone downloads real hours without sending its zero-minute copy',async()=>{
    const remote=structuredClone(initial);remote.sessionPlants=[{id:'ipad',mins:86}];
    const h=cloudAppHarness(initial,remote,{meta:{localRevision:102,dirtyRevision:102,lastSyncedRevision:100}}),ctx=h.boot();
    expect(await ctx.requestCloudRefresh()).toBe(true);
    expect(minutes(ctx)).toBe(86);expect(h.state().writes).toBe(0);
    expect(ctx.SyncCore.isDirty(ctx._readSyncMeta())).toBe(false);
  });
  it('confirms a committed upload whose response was lost without writing it again',async()=>{
    let row={data:structuredClone(initial),updated_at:'v1'},writes=0;
    const h=cloudAppHarness(initial,initial,{query:async({operation,value})=>{
      if(operation==='read')return {data:structuredClone(row)};
      row={data:Doc.mergeRemote(row.data,value.data),updated_at:'v2'};writes++;
      return {error:{code:'CLOUD_REQUEST_TIMEOUT',message:'Response lost after commit'}};
    }}),ctx=h.boot();study(ctx,'pending',86);
    expect(await ctx.syncPendingCloudChanges()).toBe(false);expect(minutes(ctx)).toBe(86);
    ctx._cloudRetryAt=0; // Retry after the backoff deadline (or explicit user retry).
    expect(await ctx.syncPendingCloudChanges()).toBe(true);expect(writes).toBe(1);
    expect(ctx.SyncCore.isDirty(ctx._readSyncMeta())).toBe(false);
  });
  it('uploads a pending history with one durable confirmation instead of a preceding download snapshot',async()=>{
    let saves=0,durable;
    const h=cloudAppHarness(initial,initial,{resilience:{persistSnapshot:async snapshot=>{saves++;durable=structuredClone(snapshot);return true;}}});
    const ctx=h.boot();study(ctx,'pending-ipad',366);
    expect(await ctx.requestCloudRefresh()).toBe(true);
    expect(saves).toBe(1);expect(h.state().writes).toBe(1);
    expect(durable.sessionPlants).toHaveLength(1);expect(minutes(ctx)).toBe(366);
    expect(ctx.SyncCore.isDirty(ctx._readSyncMeta())).toBe(false);
  });
  it('does not mark a partial server acknowledgement as synchronized',async()=>{
    let row={data:structuredClone(initial),updated_at:'v1'};
    const h=cloudAppHarness(initial,initial,{query:async({operation,value})=>{
      if(operation==='read')return {data:structuredClone(row)};
      row={...structuredClone(value),updated_at:'v2'};row.data.sessionPlants=[];
      return {data:structuredClone(row)};
    }}),ctx=h.boot();study(ctx,'unconfirmed-study',360);
    expect(await ctx.syncPendingCloudChanges()).toBe(false);
    expect(ctx._cloudStage.code).toBe('CLOUD_CONFIRMATION_MISSING');expect(minutes(ctx)).toBe(360);
    expect(ctx.SyncCore.isDirty(ctx._readSyncMeta())).toBe(true);expect(h.state().writes).toBe(1);
  });
  it('six hours on iPad become eight on phone and return to iPad with goal edits',async()=>{
    const cloud=sharedCloud(),ipad=cloud.device(),phone=cloud.device(),a=ipad.boot(),b=phone.boot();
    await a.requestCloudRefresh();study(a,'ipad-six-hours',360);await a.syncPendingCloudChanges();
    await b.requestCloudRefresh();expect(minutes(b)).toBe(360);
    study(b,'phone-two-hours',120);await b.syncPendingCloudChanges();
    await a.requestCloudRefresh();expect(minutes(a)).toBe(480);
    a.db.germanStudy.goals[0].name='Kindle rebajado';a.saveLocalNow();await a.syncPendingCloudChanges();
    await b.requestCloudRefresh();expect(b.db.germanStudy.goals[0].name).toBe('Kindle rebajado');
    expect(minutes(a)).toBe(480);expect(minutes(b)).toBe(480);
    await phone.open();expect(phone.state().local.sessionPlants).toHaveLength(2);
  });
  it('a clean device probes without uploading an echo and renders a new download',async()=>{
    const cloud=sharedCloud(),a=cloud.device().boot(),b=cloud.device().boot();let renders=0;
    b.refreshStudyViews=()=>renders++;
    await b.requestCloudRefresh();const first=renders;
    await b.requestCloudRefresh();expect(cloud.state()).toMatchObject({probes:1,writes:0});expect(renders).toBe(first);
    study(a,'new',360);await a.syncPendingCloudChanges();await b.requestCloudRefresh();
    expect(minutes(b)).toBe(360);expect(renders).toBeGreaterThan(first);expect(cloud.state().writes).toBe(1);
  });
  it('concurrent saves conflict safely and preserve both sessions exactly once',async()=>{
    const cloud=sharedCloud(),a=cloud.device().boot(),b=cloud.device().boot();
    study(a,'a',360);study(b,'b',120);
    await Promise.all([a.syncPendingCloudChanges(),b.syncPendingCloudChanges()]);
    await Promise.all([a.requestCloudRefresh(),b.requestCloudRefresh()]);
    expect(cloud.state().conflicts).toBeGreaterThan(0);
    expect(cloud.state().row.data.sessionPlants).toHaveLength(2);expect(minutes(a)).toBe(480);expect(minutes(b)).toBe(480);
  });
  it('offline additions survive newer remote study and are not called synchronized',async()=>{
    const cloud=sharedCloud(),a=cloud.device().boot(),b=cloud.device().boot();
    await b.requestCloudRefresh();cloud.offline.add(b);study(b,'offline-phone',120);
    expect(await b.requestCloudRefresh()).toBe(false);expect(b.SyncCore.isDirty(b._readSyncMeta())).toBe(true);
    study(a,'online-ipad',360);await a.syncPendingCloudChanges();cloud.offline.delete(b);
    b._cloudRetryAt=0; // Connection recovered after the retry deadline.
    expect(await b.requestCloudRefresh()).toBe(true);await a.requestCloudRefresh();
    expect(minutes(a)).toBe(480);expect(minutes(b)).toBe(480);expect(b.SyncCore.isDirty(b._readSyncMeta())).toBe(false);
  });
  it('queued work from a signed-out account cannot upload into another account',async()=>{
    const cloud=sharedCloud(),a=cloud.device().boot();study(a,'private-session',60);
    const operation=a.syncToCloud(structuredClone(a.db),a._readSyncMeta().dirtyRevision);
    a._cloudAuthEpoch++;
    expect(await operation).toBe(false);expect(cloud.state().writes).toBe(0);
  });
  it('a failed refresh on a clean device stays pending even when an upload wrapper reports success',async()=>{
    const cloud=sharedCloud(),b=cloud.device().boot(),messages=[];
    b.showSyncIndicator=message=>messages.push(message);
    await b.requestCloudRefresh();cloud.offline.add(b);
    b.syncPendingCloudChanges=async()=>{messages.push('✓ Supabase');return true;};
    expect(await b.requestCloudRefresh()).toBe(false);
    expect(messages.at(-1)).toContain('actualización pendiente');expect(cloud.state().writes).toBe(0);
  });
  it('serializes a delayed download and upload while preserving an edit made during the download',async()=>{
    let release,started,active=0,max=0,first=true;
    const gate=new Promise(resolve=>release=resolve),entered=new Promise(resolve=>started=resolve);
    const h=cloudAppHarness(initial,initial,{beforeRead:async()=>{
      active++;max=Math.max(max,active);
      if(first){first=false;started();await gate;}active--;
    }}),ctx=h.boot();
    const download=ctx.loadFromCloud();await entered;study(ctx,'during-download',60);
    const upload=ctx.syncPendingCloudChanges();await Promise.resolve();expect(h.state().reads).toBe(1);
    release();await Promise.all([download,upload]);
    expect(max).toBe(1);expect(h.state().row.data.sessionPlants).toHaveLength(1);expect(minutes(ctx)).toBe(60);
    expect(ctx.SyncCore.isDirty(ctx._readSyncMeta())).toBe(false);
  });
});
