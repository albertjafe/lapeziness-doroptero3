import {describe,it,expect} from 'vitest';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync('crono-state-store.js','utf8'),key='pianoCrono_v2';
function harness({local=null,disk=null,quota=false,failIDB=false}={}){
  const storage=new Map(local?[[key,JSON.stringify(local)]]:[]);
  let saved=disk;
  const root={
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,value)=>{if(quota)throw new Error('quota');storage.set(k,value);}},
    indexedDB:{open(){
      const request={};
      queueMicrotask(()=>{
        if(failIDB){request.error=new Error('unavailable');request.onerror();return;}
        request.result={transaction(){
          const tx={objectStore:()=>({
            get(){const req={};queueMicrotask(()=>{req.result=saved?{id:'latest',snapshot:saved}:null;req.onsuccess();});return req;},
            put(record){saved=structuredClone(record.snapshot);queueMicrotask(()=>tx.oncomplete());}
          })};return tx;
        }};
        request.onsuccess();
      });return request;
    }}
  };
  function load(){vm.runInNewContext(source,{window:root,setTimeout,clearTimeout,Date,JSON,Promise});return root.CronoStateStore;}
  return {load,storage,disk:()=>saved};
}
describe('durable active timer snapshots',()=>{
  it('uses IndexedDB when localStorage writes fail and restores on a new page',async()=>{
    const h=harness({quota:true}),store=h.load();
    await store.ready;
    expect(await store.save({state:'running',runId:'r',startTs:Date.now()})).toBe(true);
    expect(h.storage.size).toBe(0);
    expect(await h.load().ready).toMatchObject({state:'running',runId:'r'});
  });
  it('prefers a newer idle tombstone over an old active local snapshot',async()=>{
    const h=harness({local:{state:'running',runId:'old',savedAt:10},disk:{state:'idle',savedAt:20}});
    expect(await h.load().ready).toMatchObject({state:'idle'});
  });
  it('preserves a legacy active snapshot against startup preference saves',async()=>{
    const h=harness({local:{state:'running',runId:'legacy'}}),store=h.load();
    await store.save({state:'idle',mode:'timer'});
    expect(await store.ready).toMatchObject({state:'running',runId:'legacy'});
  });
  it('keeps a newer local state when the independent copy is stale',async()=>{
    const h=harness({local:{state:'paused',savedAt:30},disk:{state:'running',savedAt:20}});
    expect(await h.load().ready).toMatchObject({state:'paused'});
  });
  it('reports a failure when neither storage can save and permits local-only recovery',async()=>{
    const h=harness({quota:true,failIDB:true}),store=h.load();await store.ready;
    expect(await store.save({state:'running'})).toBe(false);
    const fallback=harness({failIDB:true}),localStore=fallback.load();await localStore.ready;
    expect(await localStore.save({state:'running',runId:'local'})).toBe(true);
    expect(await fallback.load().ready).toMatchObject({runId:'local'});
  });
});
