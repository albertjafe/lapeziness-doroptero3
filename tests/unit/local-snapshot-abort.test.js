import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {it,expect} from 'vitest';
it('an aborted IndexedDB transaction settles the save instead of freezing synchronization',async()=>{
  const ctx={db:{sessionPlants:[{id:'saved-study',mins:366}]},DB_KEY:'db',saveLocalNow(){},setTimeout:()=>1,clearTimeout(){},console:{error(){},warn(){}},
    localStorage:{setItem(){throw Error('QuotaExceededError');}},indexedDB:{open(){
      const request={};queueMicrotask(()=>{request.result={close(){},transaction(){
        const tx={objectStore:()=>({put(){}}),error:new Error('IndexedDB aborted')};queueMicrotask(()=>tx.onabort?.());return tx;
      }};request.onsuccess();});return request;
    }}};
  ctx.window=ctx;vm.createContext(ctx);vm.runInContext(readFileSync('local-save-resilience.js','utf8'),ctx);
  expect(await ctx.LocalSaveResilience.persistSnapshot(ctx.db)).toBe(false);
  expect(ctx.LocalSaveResilience.hasPendingRescue()).toBe(false);expect(ctx.db.sessionPlants[0].mins).toBe(366);
});
