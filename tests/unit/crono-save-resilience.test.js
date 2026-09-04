import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const rescue = readFileSync(new URL('../../crono-save-resilience.js', import.meta.url), 'utf8');
const headerJs = readFileSync(new URL('../../crono-running-premium.js', import.meta.url), 'utf8');
const headerCss = readFileSync(new URL('../../crono-running-premium.css', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../../piano-rooms.js', import.meta.url), 'utf8');

describe('cronometro resilient save and readable header', () => {
  it('compiles the new browser layers', () => {
    expect(() => new vm.Script(rescue)).not.toThrow();
    expect(() => new vm.Script(headerJs)).not.toThrow();
  });

  it('keeps the Hecho flow alive when local persistence fails', () => {
    expect(rescue).toContain('persisted:true,degradedPersistence:true');
    expect(rescue).toContain('rescuePut(entry)');
    expect(rescue).toContain('protectCloud');
    expect(rescue).toContain("piano_timer_rescue_v1");
  });

  it('moves readiness out of absolute positioning and gives it a readable pill', () => {
    expect(headerCss).toContain('position:static !important');
    expect(headerCss).toContain('#cronoRunReadiness');
    expect(headerCss).toContain('font-size:9.5px !important');
    expect(headerCss).toContain("#cronoRunMovementTotal::before { content:'Mov.'; }");
  });

  it('loads resilience before the rest of the timer presentation addons', () => {
    expect(bootstrap).toContain('cronoSaveResilienceScript');
    expect(bootstrap).toContain('cronoRunningPremiumScript');
    expect(bootstrap.indexOf('cronoSaveResilienceScript')).toBeLessThan(bootstrap.indexOf('cronoRunningPremiumScript'));
  });

  it('does not dirty or upload an unchanged document during update protection', async () => {
    const document={_localRevision:9,_savedAt:'2026-09-04T18:00:00Z',sesiones:[{id:'kept',mins:40}]};
    const storage=new Map([['alberto_piano_v2',JSON.stringify(document)]]);
    let saves=0;let syncs=0;
    const window={
      localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
      DocumentSyncCore:{sameContent:(a,b)=>{
        const clean=value=>{const copy=structuredClone(value);delete copy._localRevision;delete copy._savedAt;return copy;};
        return JSON.stringify(clean(a))===JSON.stringify(clean(b));
      }},
    };
    const context={
      window,db:structuredClone(document),structuredClone,JSON,Promise,setTimeout,clearTimeout,
      finishStudyBlock(){},saveData(){},recordSessionPlant(){},refreshStudyViews(){},enqueueCloudSync(){},
      saveLocalNow(){saves+=1;storage.set('alberto_piano_v2',JSON.stringify(context.db));},
      syncPendingCloudChanges:async()=>{syncs+=1;},
      SyncCore:{isDirty:()=>false},_readSyncMeta:()=>({}),
    };
    vm.runInNewContext(rescue,context);

    expect(await window.CronoSaveResilience.protectCloud()).toBe(true);
    expect(saves).toBe(0);
    expect(syncs).toBe(1);
    expect(JSON.parse(storage.get('alberto_piano_v2')).sesiones[0].mins).toBe(40);
  });

  it('persists a real timer change exactly once before cloud protection', async () => {
    const disk={_localRevision:2,_savedAt:'2026-09-04T18:00:00Z',sesiones:[]};
    const storage=new Map([['alberto_piano_v2',JSON.stringify(disk)]]);
    let saves=0;
    const window={
      localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
      DocumentSyncCore:{sameContent:(a,b)=>JSON.stringify(a.sesiones)===JSON.stringify(b.sesiones)},
    };
    const context={
      window,db:{...disk,sesiones:[{id:'new-session',mins:40}]},JSON,Promise,setTimeout,clearTimeout,
      finishStudyBlock(){},saveData(){},recordSessionPlant(){},refreshStudyViews(){},enqueueCloudSync(){},
      saveLocalNow(){saves+=1;storage.set('alberto_piano_v2',JSON.stringify(context.db));},
      syncPendingCloudChanges:async()=>true,SyncCore:{isDirty:()=>false},_readSyncMeta:()=>({}),
    };
    vm.runInNewContext(rescue,context);

    expect(await window.CronoSaveResilience.protectCloud()).toBe(true);
    expect(saves).toBe(1);
    expect(JSON.parse(storage.get('alberto_piano_v2')).sesiones[0].id).toBe('new-session');
  });
});
