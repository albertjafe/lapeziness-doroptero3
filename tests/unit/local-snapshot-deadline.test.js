import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect} from 'vitest';

function harness(mode){
  let next=0,closed=0,durable=null;
  const timers=new Map(),requests=[],transactions=[],state={mode};
  function database(){return {close(){closed++;},transaction(){
    const tx={aborted:false,abort(){tx.aborted=true;queueMicrotask(()=>tx.onabort?.());},objectStore:()=>({put(row){
      if(state.mode!=='write')queueMicrotask(()=>{if(!tx.aborted){durable=structuredClone(row);tx.oncomplete?.();}});
    }})};transactions.push(tx);return tx;
  }};}
  const ctx={db:{sessionPlants:[{id:'study',mins:366}]},DB_KEY:'db',saveLocalNow(){},
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
  expect(h.transactions.length).toBe(transactions);expect(h.closed()).toBe(2);
  expect(h.durable().data.sessionPlants[0].mins).toBe(367);
});

it('aborts a silent write before allowing a newer snapshot to commit',async()=>{
  const h=harness('write'),saving=h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db);
  await h.flush();h.expire();expect(await saving).toBe(false);
  expect(h.transactions[0].aborted).toBe(true);
  expect(h.ctx.LocalSaveResilience.lastErrorCode()).toBe('IDB_WRITE_TIMEOUT');
  h.state.mode='normal';h.ctx.db.sessionPlants[0].mins=367;
  expect(await h.ctx.LocalSaveResilience.persistSnapshot(h.ctx.db)).toBe(true);
  h.transactions[0].oncomplete();
  expect(h.durable().data.sessionPlants[0].mins).toBe(367);
  expect(h.ctx.db.sessionPlants[0].mins).toBe(367);
});
