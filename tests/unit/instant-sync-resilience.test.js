import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SyncResilience = require('../../instant-sync-resilience.js');

describe('InstantSyncResilience', () => {
  it('refreshes on foreground and reconnect events, polls while visible and uploads on hiding',async()=>{
    const events={},documentEvents={},intervals=[];let downloads=0,uploads=0;
    const ctx={_cloudSyncConnected:true,requestCloudRefresh:async()=>{downloads++;return true;},syncPendingCloudChanges:async()=>{uploads++;return true;},
      addEventListener:(name,fn)=>{events[name]=fn;},document:{readyState:'complete',visibilityState:'visible',getElementById:()=>null,addEventListener:(name,fn)=>{documentEvents[name]=fn;}},
      localStorage:{getItem:()=>'{"dirtyRevision":0,"lastSyncedRevision":0}'},SyncCore:{isDirty:()=>false},setInterval:(fn,ms)=>{intervals.push({fn,ms});return 1;},clearInterval(){},setTimeout:()=>1,clearTimeout(){}};
    vm.createContext(ctx);vm.runInContext(readFileSync('instant-sync-resilience.js','utf8'),ctx);
    for(const name of ['focus','pageshow','online']){events[name]();await Promise.resolve();}
    expect(downloads).toBe(3);
    ctx.document.visibilityState='hidden';documentEvents.visibilitychange();await Promise.resolve();
    expect(uploads).toBe(1);intervals.find(i=>i.ms===30000).fn();expect(downloads).toBe(3);
    ctx.document.visibilityState='visible';documentEvents.visibilitychange();await Promise.resolve();
    intervals.find(i=>i.ms===30000).fn();await Promise.resolve();expect(downloads).toBe(5);
  });
  it('coalesces concurrent requests without overlapping writes', async () => {
    let running = 0;
    let maxRunning = 0;
    let calls = 0;
    let release;
    const gate = new Promise(resolve => { release = resolve; });

    const sync = SyncResilience.createSingleFlight(async () => {
      calls += 1;
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      if (calls === 1) await gate;
      await Promise.resolve();
      running -= 1;
      return calls;
    });

    const first = sync();
    const second = sync();
    const third = sync();
    release();
    await Promise.all([first, second, third]);

    expect(maxRunning).toBe(1);
    expect(calls).toBe(2);
  });
  it('does not immediately rerun coalesced requests after a failed upload',async()=>{
    let calls=0,release;const gate=new Promise(resolve=>{release=resolve;});
    const sync=SyncResilience.createSingleFlight(async()=>{calls++;await gate;return false;});
    const first=sync(),second=sync();release();await Promise.all([first,second]);
    expect(calls).toBe(1);
  });
  it('foreground events and pending writes respect the shared retry deadline',()=>{
    let calls=0;const delays=[];
    const ctx={cloudRetryDelay:()=>30000,requestCloudRefresh:async()=>{calls++;return false;},
      setTimeout:(fn,ms)=>{delays.push(ms);return 1;},clearTimeout(){}};
    vm.createContext(ctx);vm.runInContext(readFileSync('instant-sync-resilience.js','utf8'),ctx);
    for(let i=0;i<20;i++)ctx.InstantSyncResilience.requestImmediateSync({refresh:true});
    expect(calls).toBe(0);expect(delays).toEqual([30000]);
  });
  it.each([
    [false,false,'Guardado local · conecta tu cuenta'],
    [true,false,'Sincronizando…'],
    [true,true,'✓ Supabase'],
    [null,true,'Guardado local · conexión sin verificar'],
  ])('reports the actual cloud outcome (connected=%s, result=%s)',async(connected,result,expected)=>{
    const messages=[],timers=[];
    const ctx={_cloudSyncConnected:connected,syncPendingCloudChanges:async()=>result,
      localStorage:{getItem:()=>JSON.stringify({dirtyRevision:1,lastSyncedRevision:1})},
      SyncCore:{isDirty:meta=>meta.dirtyRevision>meta.lastSyncedRevision},showSyncIndicator:message=>messages.push(message),
      setTimeout:(fn,delay)=>{timers.push(delay);return 1;},clearTimeout(){}};
    vm.createContext(ctx);vm.runInContext(readFileSync('instant-sync-resilience.js','utf8'),ctx);
    ctx.InstantSyncResilience.install();await ctx.syncPendingCloudChanges();
    expect(messages.at(-1)).toBe(expected);
    if(!connected)expect(timers).toEqual([]);
    if(result===false)expect(messages).not.toContain('✓ Supabase');
  });
});
