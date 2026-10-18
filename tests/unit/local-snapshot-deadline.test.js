import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {it,expect} from 'vitest';
const Sync=createRequire(import.meta.url)('../../document-sync-core.js');

function harness(mode,initial=null){
  let next=0,closed=0,durable=initial&&{id:'latest',data:structuredClone(initial)};
  const timers=new Map(),requests=[],transactions=[],state={mode};
  function database(){return {close(){closed++;},transaction(store,access){
    const tx={access,aborted:false,abort(){tx.aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore:()=>({get(){
      const request={};if(state.mode!=='read')queueMicrotask(()=>{request.result=structuredClone(durable);request.onsuccess?.();});return request;
    },put(row){
      if(state.mode!=='write')queueMicrotask(()=>{if(!tx.aborted){durable=structuredClone(row);tx.oncomplete?.();}});
    }})};transactions.push(tx);return tx;
  }};}
  const ctx={db:{sessionPlants:[{id:'study',mins:366}]},DB_KEY:'db',DocumentSyncCore:Sync,saveLocalNow(){},
    setTimeout:(fn,delay)=>{if(delay<10000)return 0;timers.set(++next,fn);return next;},clearTimeout:id=>timers.delete(id),
    console:{error(){},warn(){}},localStorage:{setItem(){throw Error('QuotaExceededError');}},indexedDB:{open(){
      const req={};requests.push(req);if(state.mode!=='open')queueMicrotask(()=>{req.result=database();req.onsuccess?.();});return req;
    }}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(readFileSync('local-save-resilience.js','utf8'),ctx);
  return {ctx,state,requests,transactions,database,closed:()=>closed,durable:()=>durable,
    expire(){const [id,fn]=[...timers.entries()][0];timers.delete(id);fn();},
    flush:()=>new Promise(resolve=>setImmediate(resolve))};
}

it('times out a silent open, closes a late connection and saves the next complete snapshot',async()=>{
  const h=harness('open'),saving=h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db);
  await h.flush();h.expire();expect(await saving).toBe(false);
  expect(h.ctx.LocalSaveResilience.lastErrorCode()).toBe('IDB_OPEN_TIMEOUT');
  expect(h.ctx.LocalSaveResilience.hasPendingRescue()).toBe(false);
  h.state.mode='normal';h.ctx.db.sessionPlants[0].mins=367;
  expect(await h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db)).toBe(true);
  const transactions=h.transactions.length;
  h.requests[0].result=h.database();h.requests[0].onsuccess();
  // Retry reads the old rescue before writing; both connections plus the late
  // timed-out open must close. That late open must not start a transaction.
  expect(h.transactions.length).toBe(transactions);expect(h.closed()).toBe(3);
  expect(h.durable().data.sessionPlants[0].mins).toBe(367);
});

it('aborts a silent write before allowing a newer snapshot to commit',async()=>{
  const h=harness('write'),saving=h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db);
  await h.flush();h.expire();expect(await saving).toBe(false);
  const writing=h.transactions.find(tx=>tx.access==='readwrite');
  expect(writing.aborted).toBe(true);
  expect(h.ctx.LocalSaveResilience.lastErrorCode()).toBe('IDB_WRITE_TIMEOUT');
  h.state.mode='normal';h.ctx.db.sessionPlants[0].mins=367;
  expect(await h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db)).toBe(true);
  writing.oncomplete();
  expect(h.durable().data.sessionPlants[0].mins).toBe(367);
  expect(h.ctx.db.sessionPlants[0].mins).toBe(367);
});

it('startup saves preserve the existing rescue, field clocks, unknown fields and deletions until recovery',async()=>{
  const oldStamp='2026-10-17T10:00:00Z',newStamp='2026-10-18T10:00:00Z';
  const original={_localRevision:100,rewardNoticeSeen:{'bonus:saved':oldStamp},future:{retained:7},
    obras:[{id:'w',name:'Saved edit',_fieldClock:{name:newStamp}}],
    sessionPlants:[{id:'rescued',mins:45,updatedAt:oldStamp,_fieldClock:{mins:oldStamp}}],
    _deletedChildren:{obras:{'id:deleted':newStamp}}};
  const h=harness('normal',original);
  const stale={_localRevision:1,obras:[{id:'w',name:'Old name',_fieldClock:{name:oldStamp}},{id:'deleted',name:'Deleted'}],sessionPlants:[]};
  // Two snapshots queued before recovery must each preserve the durable data.
  const a=h.ctx.LocalSaveResilience.persistSnapshot(stale);
  const b=h.ctx.LocalSaveResilience.persistSnapshot({...stale,sessionPlants:[{id:'new',mins:25}]});
  expect(await a).toBe(true);expect(await b).toBe(true);
  const saved=h.durable().data;
  expect(saved.rewardNoticeSeen).toEqual(original.rewardNoticeSeen);
  expect(saved.future).toEqual(original.future);
  expect(saved.obras).toEqual(original.obras);
  expect(saved.sessionPlants).toHaveLength(2);
  expect(saved.sessionPlants.find(x=>x.id==='rescued')).toEqual(original.sessionPlants[0]);
  expect(saved._deletedChildren).toEqual(original._deletedChildren);
});

it('a timed-out startup read never overwrites the rescue as if it were empty, and a retry retains it',async()=>{
  const original={sessionPlants:[{id:'rescued',mins:45}],rewardNoticeSeen:{'bonus:saved':'2026-10-18T10:00:00Z'}};
  const h=harness('read',original),saving=h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db);
  await h.flush();h.expire();expect(await saving).toBe(false);
  expect(h.ctx.LocalSaveResilience.lastErrorCode()).toBe('IDB_READ_TIMEOUT');
  expect(h.transactions[0].aborted).toBe(true);
  expect(h.transactions.every(tx=>tx.access==='readonly')).toBe(true);
  expect(h.durable().data).toEqual(original);
  h.state.mode='normal';
  expect(await h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db)).toBe(true);
  expect(h.durable().data.sessionPlants).toHaveLength(2);
  expect(h.durable().data.rewardNoticeSeen).toEqual(original.rewardNoticeSeen);
});

it('normal saves stop re-reading the rescue after successful startup recovery',async()=>{
  const h=harness('normal');
  expect(await h.ctx.LocalSaveResilience.recoverSnapshot()).toBe(false);
  expect(await h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db)).toBe(true);
  h.ctx.db.sessionPlants[0].mins=367;
  expect(await h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db)).toBe(true);
  expect(h.transactions.map(tx=>tx.access)).toEqual(['readonly','readwrite','readwrite']);
  expect(h.durable().data.sessionPlants[0].mins).toBe(367);
});
