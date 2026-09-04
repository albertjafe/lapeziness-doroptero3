import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const DocumentSyncCore=require('../../document-sync-core.js'),SyncCore=require('../../sync-core.js'),DataCore=require('../../data-core.js');
const source=readFileSync('app.js','utf8');
const localFunctions=source.slice(source.indexOf('function _readSyncMeta('),source.indexOf('// Una mutación de estudio'));
const cloudFunctions=source.slice(source.indexOf('function _mergeStudyHistory('),source.indexOf('\nfunction showSyncIndicator('));
// Real load/save/queue/upload functions, durable storage across fresh VM boots,
// and an asynchronous fake of only the Supabase transport boundary.
export function cloudAppHarness(local,remote,options={}){
  const userId=options.userId||'u';
  const storage=new Map([['db',JSON.stringify(local)]]);
  if(options.meta!==null)storage.set('meta',JSON.stringify(options.meta||{localRevision:100,dirtyRevision:100,lastSyncedRevision:100}));
  let row=remote==null?null:{id:userId,data:structuredClone(remote),updated_at:'v1'},writes=0,reads=0,queued=0,ctx;
  const client={auth:{getUser:async()=>({data:{user:{id:userId}}})},from:()=>{
    let operation='read',value,expected;
    const execute=async(single)=>{
      if(operation==='read'){
        reads++;await options.beforeRead?.(ctx,reads);
        if(options.failRead)return {error:{code:'NETWORK',message:'offline'}};
        if(options.query){const result=await options.query({operation,value,expected,ctx});row=result.data;return result;}
        if(!row&&single)return {error:{code:'PGRST116',message:'zero rows'}};
        return {data:structuredClone(row)};
      }
      writes++;
      if(options.query){const result=await options.query({operation,value,expected,ctx});if(result.data)row=result.data;return result;}
      if(operation==='update'&&expected!==row?.updated_at)return {data:null};
      row={...structuredClone(value),updated_at:'v'+(writes+1)};
      return {data:structuredClone(row)};
    };
    const q={select:()=>q,eq:(k,v)=>{if(k==='updated_at')expected=v;return q;},
      update:v=>{operation='update';value=v;return q;},insert:v=>{operation='insert';value=v;return q;},
      single:()=>execute(true),maybeSingle:()=>execute(false)};
    return q;
  }};
  function boot(){
      ctx={db:JSON.parse(storage.get('db')),DB_KEY:'db',SYNC_META_KEY:'meta',DocumentSyncCore,SyncCore,DataCore,
        Date,JSON,console,_syncInFlight:false,_syncPromise:null,_syncTimer:null,
        localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},getSB:()=>client,
        setTimeout:()=>++queued,clearTimeout(){},showSyncIndicator(){},refreshStudyViews(){}};
      vm.createContext(ctx);vm.runInContext(localFunctions+'\n'+cloudFunctions,ctx);
    return ctx;
  }
  return {
    boot,
    async open(){ boot(); return this.reconnect(); },
    async reconnect(load=true){
      if(!ctx)boot();
      const result=load?await ctx.loadFromCloud():true;await ctx.syncPendingCloudChanges();
      return result;
    },
    state:()=>({row,writes,reads,queued,local:JSON.parse(storage.get('db')),meta:JSON.parse(storage.get('meta')||'null')}),
  };
}

// Unrelated real saves raise the local revision without editing the work.
export function saveUnrelatedOffline(ctx,count=200){
  ctx.db.cronoTasks ||= [];
  ctx.db.cronoTasks.push({id:'offline-task',text:'Nueva tarea'});
  for(let i=0;i<count;i++){ctx.db.cronoTasks.at(-1).text='Nueva tarea '+i;ctx.saveLocalNow();}
}
