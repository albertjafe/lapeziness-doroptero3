import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const SyncResilience = require('../../instant-sync-resilience.js');

describe('InstantSyncResilience', () => {
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
