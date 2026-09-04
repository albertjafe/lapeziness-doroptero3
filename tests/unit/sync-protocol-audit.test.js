import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {describe,it,expect} from 'vitest';
const require=createRequire(import.meta.url),Doc=require('../../document-sync-core.js');
const source=readFileSync('app.js','utf8');
const syncSource=source.slice(source.indexOf('async function syncToCloud('),source.indexOf('\nfunction enqueueCloudSync('));
function harness(local,remote,options={}){
  let row=structuredClone(remote),writes=0,reads=0,meta={localRevision:2,dirtyRevision:2,lastSyncedRevision:1};
  const store=new Map([['db',JSON.stringify(local)]]);
  const ctx={db:structuredClone(local),DocumentSyncCore:Doc,DB_KEY:'db',console,Date,JSON,
    localStorage:{setItem:(k,v)=>store.set(k,v)},_mergeStudyHistory:(a,b)=>Doc.merge(b,a),
    _readSyncMeta:()=>meta,_writeSyncMeta:v=>{meta=v;},_rememberLocalDocument(){},showSyncIndicator(){}};
  const client={auth:{getUser:async()=>({data:{user:{id:'u'}}})},from:()=>{
    let operation='read',value=null,expected=null;
    const q={select:()=>q,eq:(k,v)=>{if(k==='updated_at')expected=v;return q;},update:v=>{operation='write';value=v;return q;},insert:v=>{operation='insert';value=v;return q;},maybeSingle:async()=>{
      if(operation==='read'){reads++;if(options.failRead)return {error:{message:'offline'}};return {data:structuredClone(row)};}
      writes++;if(options.beforeWrite)options.beforeWrite({ctx,getRow:()=>row,setRow:v=>{row=v;},getMeta:()=>meta,setMeta:v=>{meta=v;},writes});
      if(options.failWrite)return {error:{message:'temporarily unavailable'}};
      if(operation==='write'&&expected!==row.updated_at)return {data:null};
      row=structuredClone(value);return {data:row};
    }};return q;
  }};
  ctx.getSB=()=>client;vm.createContext(ctx);vm.runInContext(syncSource,ctx);
  return {ctx,store,run:()=>ctx.syncToCloud(structuredClone(local),2),state:()=>({row,meta,writes,reads})};
}
const old={obras:[{id:'w',name:'Sonata',dificultad:4,movimientos:[{id:'m',sol:40}]}],sessionPlants:[]};
const edit=(fn,time)=>{const d=structuredClone(old);fn(d);return Doc.track(d,old,time);};
describe('actual app upload protocol against asynchronous Supabase responses',()=>{
  it('keeps an explicit field edit made while a stale upload awaits acknowledgement',async()=>{
    const server={_localRevision:100,obras:[{id:'w',dificultad:9}],cronoTasks:[]};
    const local={_localRevision:170,obras:[{id:'w',dificultad:5}],cronoTasks:[{id:'new',text:'Nueva tarea'}]};
    const h=harness(local,{data:server,updated_at:'v1'},{beforeWrite:({ctx,setMeta})=>{
      const edited=structuredClone(ctx.db);edited.obras[0].dificultad=7;
      ctx.db=Doc.track(edited,ctx.db,'2026-09-04T12:00:00.000Z');
      setMeta({localRevision:171,dirtyRevision:171,lastSyncedRevision:100});
    }});
    expect(await h.run()).toBe(true);
    expect(h.state().row.data).toMatchObject({obras:[{dificultad:9}],cronoTasks:[{id:'new'}]});
    expect(h.ctx.db.obras[0].dificultad).toBe(7);
    expect(h.state().meta.dirtyRevision).toBeGreaterThan(h.state().meta.lastSyncedRevision);
    expect(JSON.parse(h.store.get('db')).obras[0].dificultad).toBe(7);
  });
  it('merges newer local data with a stale remote document',async()=>{
    const local=edit(d=>{d.obras[0].movimientos[0].sol=88;},'2026-09-04T11:00:00Z');
    const h=harness(local,{data:old,updated_at:'v1'});expect(await h.run()).toBe(true);
    expect(h.state().row.data.obras[0].movimientos[0].sol).toBe(88);
  });
  it('rereads after a compare-and-swap conflict and preserves both devices',async()=>{
    const local=edit(d=>{d.obras[0].dificultad=9;},'2026-09-04T10:00:00Z');
    const other=edit(d=>{d.obras[0].movimientos[0].sol=90;},'2026-09-04T11:00:00Z');
    const h=harness(local,{data:old,updated_at:'v1'},{beforeWrite:({setRow,writes})=>{if(writes===1)setRow({data:other,updated_at:'v2'});}});
    expect(await h.run()).toBe(true);expect(h.state().reads).toBe(2);
    expect(h.state().row.data.obras[0]).toMatchObject({dificultad:9,movimientos:[{sol:90}]});
  });
  it('a new local session arriving during upload remains dirty and survives acknowledgement',async()=>{
    const h=harness(old,{data:old,updated_at:'v1'},{beforeWrite:({ctx,setMeta})=>{
      ctx.db=Doc.track({...ctx.db,sessionPlants:[{id:'just-saved',mins:25}]},ctx.db,'2026-09-04T12:00:00Z');
      setMeta({localRevision:3,dirtyRevision:3,lastSyncedRevision:1});
    }});
    expect(await h.run()).toBe(true);expect(h.ctx.db.sessionPlants).toHaveLength(1);
    expect(h.state().meta.dirtyRevision).toBeGreaterThan(h.state().meta.lastSyncedRevision);
    expect(JSON.parse(h.store.get('db')).sessionPlants[0].id).toBe('just-saved');
  });
  it.each(['failRead','failWrite'])('%s never replaces the durable local copy',async flag=>{
    const h=harness(old,{data:{obras:[]},updated_at:'v1'},{[flag]:true});const before=h.store.get('db');
    expect(await h.run()).toBe(false);expect(h.store.get('db')).toBe(before);
    if(flag==='failRead')expect(h.state().writes).toBe(0);
  });
  it('retrying an acknowledged timer upload does not duplicate the record',async()=>{
    const d={...old,sessionPlants:[{id:'timer',mins:25}]};const h=harness(d,{data:d,updated_at:'v1'});
    await h.run();await h.run();expect(h.state().row.data.sessionPlants).toHaveLength(1);
  });
});
