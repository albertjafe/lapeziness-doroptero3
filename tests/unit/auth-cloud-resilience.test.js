import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {describe,it,expect} from 'vitest';
import {cloudAppHarness} from '../fixtures/cloud-app-harness.js';

const source=readFileSync('app.js','utf8');
const authCode=source.slice(source.indexOf('function _installAuthSync('),source.indexOf('async function initApp('));
function authHarness(){
  let callback,locked=false,reads=0,installs=0,next=0;
  const jobs=new Map(),messages=[];
  const sb={auth:{onAuthStateChange:fn=>{callback=fn;installs++;return {data:{subscription:{}}};},
    getUser:async()=>{if(locked)throw Error('Supabase auth deadlock');reads++;return {data:{user:{id:'u'}}};}}};
  const ctx={_authSyncSubscription:null,_authSyncTimer:null,_cloudSyncConnected:true,
    setTimeout:fn=>{jobs.set(++next,fn);return next;},clearTimeout:id=>jobs.delete(id),
    onAuthSuccess:()=>sb.auth.getUser(),showSyncIndicator:msg=>messages.push(msg),_cloudSyncErrorText:err=>err.message};
  vm.createContext(ctx);vm.runInContext(authCode,ctx);ctx._installAuthSync(sb);
  return {ctx,sb,messages,installs:()=>installs,reads:()=>reads,
    emit(event,session={}){locked=true;try{return callback(event,session);}finally{locked=false;}},
    async flush(){for(const fn of jobs.values())fn();jobs.clear();await new Promise(resolve=>setImmediate(resolve));}};
}

describe('auth events and durable cloud downloads',()=>{
  it.each(['SIGNED_IN','TOKEN_REFRESHED'])('%s performs client calls after the auth lock is released',async event=>{
    const h=authHarness();expect(h.emit(event)).toBeUndefined();expect(h.reads()).toBe(0);
    await h.flush();expect(h.reads()).toBe(1);expect(h.messages).toEqual([]);
  });
  it('coalesces repeated events and cancels pending work on sign out',async()=>{
    const h=authHarness();h.ctx._installAuthSync(h.sb);expect(h.installs()).toBe(1);
    h.emit('SIGNED_IN');h.emit('TOKEN_REFRESHED');await h.flush();expect(h.reads()).toBe(1);
    h.emit('SIGNED_IN');h.emit('SIGNED_OUT',null);await h.flush();expect(h.reads()).toBe(1);
    expect(h.ctx._cloudSyncConnected).toBe(false);
  });
  it('downloads recovered cloud sessions through the durable quota fallback without an echo upload',async()=>{
    let durable;
    const data={_localRevision:100,obras:[],sessionPlants:[{id:'recovered',mins:240}],sesiones:[]};
    const h=cloudAppHarness(data,data,{quota:true,resilience:{persistSnapshot:async snapshot=>{durable=structuredClone(snapshot);return true;}}});
    expect(await h.open()).toBe(true);
    expect(durable.sessionPlants).toEqual(data.sessionPlants);
    expect(h.state().writes).toBe(0);
    expect(h.state().meta.dirtyRevision).toBe(h.state().meta.lastSyncedRevision);
  });
  it('preserves study saved while a download is being persisted',async()=>{
    let enter,release;
    const started=new Promise(resolve=>{enter=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    const data={_localRevision:100,obras:[],sessionPlants:[],sesiones:[]};
    const h=cloudAppHarness(data,data,{resilience:{persistSnapshot:async()=>{enter();await gate;return true;}}});
    const ctx=h.boot(),loading=ctx.loadFromCloud();await started;
    ctx.db.sessionPlants.push({id:'during-download',mins:30});ctx.saveLocalNow();
    release();await loading;expect(h.state().meta.dirtyRevision).toBeGreaterThan(h.state().meta.lastSyncedRevision);
    await ctx.syncPendingCloudChanges();expect(h.state().row.data.sessionPlants).toHaveLength(1);
  });
});
